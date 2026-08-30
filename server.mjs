import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { networkInterfaces, cpus, totalmem, freemem, uptime } from 'os';
import { mkdir, readFile, writeFile, rename, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import multer from 'multer';
import { cdpBridge } from './cdp_bridge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8787');
const DATA_DIR = join(__dirname, 'data');
const STATE_FILE = join(DATA_DIR, 'state.json');
const UPLOAD_DIR = '/tmp/ag_uploads';

await mkdir(DATA_DIR, { recursive: true });
await mkdir(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const safeName = Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({ storage });

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

let STATE = {
  messages: [],
  agent: { state: 'idle', busy: false, lastActive: null },
  actions: { autoAccept: { available: false, enabled: false }, permissionPrompt: null, pendingButtons: [] },
  outbox: [],
  currentTarget: cdpBridge.currentTarget || 'vm'
};

async function loadState() {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.messages)) STATE.messages = data.messages;
    if (data.agent) STATE.agent = { ...STATE.agent, ...data.agent };
    if (Array.isArray(data.outbox)) STATE.outbox = data.outbox;
    if (data.currentTarget) {
      STATE.currentTarget = data.currentTarget;
      cdpBridge.currentTarget = data.currentTarget;
    }
  } catch (err) {}
}

async function saveState() {
  try {
    const tempFile = `${STATE_FILE}.tmp`;
    await writeFile(tempFile, JSON.stringify(STATE, null, 2));
    await rename(tempFile, STATE_FILE);
  } catch (err) {}
}

function broadcast(event, payload = {}) {
  const msg = JSON.stringify({ event, payload, ts: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

function getSystemStats() {
  const totalMb = Math.round(totalmem() / (1024 * 1024));
  const freeMb = Math.round(freemem() / (1024 * 1024));
  const usedMb = totalMb - freeMb;
  const ramPercent = Math.round((usedMb / totalMb) * 100);

  const cpuList = cpus();
  let userTotal = 0, sysTotal = 0, idleTotal = 0;
  for (const cpu of cpuList) {
    userTotal += cpu.times.user;
    sysTotal += cpu.times.sys;
    idleTotal += cpu.times.idle;
  }
  const totalTicks = userTotal + sysTotal + idleTotal;
  const cpuPercent = totalTicks > 0 ? Math.round(((userTotal + sysTotal) / totalTicks) * 100) : 0;

  return {
    cpu: cpuPercent,
    ram: usedMb, ramDetails: { usedMb, totalMb, percent: ramPercent },
    ramMb: usedMb,
    uptimeSec: Math.round(uptime()),
    clients: wss.clients.size,
    cdpConnected: cdpBridge.connected,
    currentTarget: cdpBridge.currentTarget,
    activeModel: cdpBridge.activeModelName || 'Gemini 3.7 Flash Medium',
    agentBusy: STATE.agent.busy,
    autoAccept: STATE.actions.autoAccept
  };
}
setInterval(() => {
  if (wss.clients.size > 0) {
    broadcast('telemetry_tick', getSystemStats());
  }
}, 2500);

function mergeAgentMessage(existingText, incomingText) {
  if (!existingText) return incomingText || '';
  if (!incomingText) return existingText || '';

  // Extract thought badge
  let thought = '';
  const tMatch = existingText.match(/^(?:Thought for [0-9smh\s]+|Worked for [0-9smh\s]+|Thinking Process:?)/i) ||
                 incomingText.match(/^(?:Thought for [0-9smh\s]+|Worked for [0-9smh\s]+|Thinking Process:?)/i);
  if (tMatch) thought = tMatch[0].trim();

  // Extract command block
  let cmd = '';
  const bashMatch = existingText.match(/```(?:bash|sh)?\n([\s\S]*?)```/i) || incomingText.match(/```(?:bash|sh)?\n([\s\S]*?)```/i);
  if (bashMatch) {
    cmd = '```bash\n' + bashMatch[1].trim() + '\n```';
  } else {
    const ranMatch = existingText.match(/(?:^|\n)((?:Ran|Run|Running|python3|bash|echo|cat|grep|curl)\s*\n?[\s\S]*?)(?=\n\n(?:[A-Z\u{1F300}-\u{1F9FF}]|Step |Here |Check |I |The |All |Note:|###?|🔍|\$\$)|$)/iu);
    if (ranMatch) {
      cmd = '```bash\n' + ranMatch[1].replace(/^(?:Ran|Run|Running)\s*\n?/i, '').trim() + '\n```';
    }
  }

  // Extract pure answer text
  let answer = incomingText.trim();
  if (thought && answer.startsWith(thought)) {
    answer = answer.slice(thought.length).trim();
  }
  if (cmd && answer.includes(cmd)) {
    answer = answer.replace(cmd, '').trim();
  }
  answer = answer.replace(/^(?:Ran|Run|Running)\s*\n[\s\S]*?(?=\n\n[A-Z\u{1F300}-\u{1F9FF}]|$)/iu, '').trim();

  let parts = [];
  if (thought) parts.push(thought);
  if (cmd) parts.push(cmd);
  if (answer) parts.push(answer);

  return parts.join('\n\n').trim();
}

cdpBridge.onAllMessages = (messages) => {
  if (Array.isArray(messages) && messages.length > 0) {
    STATE.messages = messages;
    saveState();
    broadcast('init_state', {
      messages: STATE.messages,
      agent: STATE.agent,
      actions: STATE.actions,
      stats: getSystemStats()
    });
  }
};

cdpBridge.onNewMessage = (msg) => {
  if (!msg || !msg.text) return;

  const cleanText = msg.text.replace(/Waiting for user input[\.]*/gi, '').trim();
  if (!cleanText) return;

  const normalizedMsg = { ...msg, text: cleanText };

  if (STATE.messages.length === 0) {
    STATE.messages.push(normalizedMsg);
    saveState();
    broadcast('message_new', normalizedMsg);
    return;
  }

  const lastIndex = STATE.messages.length - 1;
  const last = STATE.messages[lastIndex];

  // 1. Exact match on last message -> ignore
  if (last.text === normalizedMsg.text && last.from === normalizedMsg.from) {
    return;
  }

  // 2. Prevent repeating old agent message if it already exists as previous agent response
  if (normalizedMsg.from === 'agent') {
    for (let i = STATE.messages.length - 1; i >= 0; i--) {
      if (STATE.messages[i].from === 'agent') {
        if (STATE.messages[i].text === normalizedMsg.text) {
          return; // Identical previous agent output, do not duplicate!
        }
        break;
      }
    }
  }

  // 3. In-place merge for streaming agent turns
  if (last.from === normalizedMsg.from && normalizedMsg.from === 'agent') {
    const mergedText = mergeAgentMessage(last.text, normalizedMsg.text);
    if (mergedText !== last.text) {
      STATE.messages[lastIndex].text = mergedText;
      STATE.messages[lastIndex].timestamp = normalizedMsg.timestamp;
      saveState();
      broadcast('message_update', { index: lastIndex, message: STATE.messages[lastIndex] });
    }
    return;
  }

  // 4. New distinct message
  STATE.messages.push(normalizedMsg);
  if (STATE.messages.length > 300) STATE.messages.shift();
  saveState();
  broadcast('message_new', normalizedMsg);
};

cdpBridge.onAgentState = (state) => {
  const prevBusy = STATE.agent.busy;
  STATE.agent.busy = state.busy;
  STATE.agent.state = state.busy ? 'executing' : 'idle';
  STATE.agent.lastActive = new Date().toISOString();
  if (prevBusy !== state.busy) {
    broadcast('agent_state', STATE.agent);
  }
};

cdpBridge.onActionDetected = (actions) => {
  STATE.actions = actions;
  broadcast('actions_detected', actions);
};

// ----------------------------------------------------------------------
// REST API Routes
// ----------------------------------------------------------------------

// 0. Target Switcher
app.get('/api/target', (req, res) => {
  res.json({ ok: true, target: cdpBridge.currentTarget });
});

app.post('/api/target/switch', async (req, res) => {
  const target = req.body?.target || req.body?.name || (cdpBridge.currentTarget === 'vm' ? 'host' : 'vm');
  if (target !== 'host' && target !== 'vm') {
    return res.status(400).json({ ok: false, error: 'invalid_target' });
  }
  const ok = await cdpBridge.switchTarget(target);
  STATE.currentTarget = target;
  saveState();
  broadcast('telemetry_tick', getSystemStats());
  res.json({ ok: true, target });
});

app.post('/api/target', async (req, res) => {
  const { target } = req.body;
  if (target !== 'host' && target !== 'vm') {
    return res.status(400).json({ ok: false, error: 'invalid_target' });
  }
  const ok = await cdpBridge.switchTarget(target);
  STATE.currentTarget = target;
  saveState();
  broadcast('telemetry_tick', getSystemStats());
  res.json({ ok, target });
});

// 1. Permission / Action Execution

// 4.2 Interactive Question Handlers
app.post('/api/actions/question/select', async (req, res) => {
  const { index } = req.body;
  if (typeof index !== 'number') return res.status(400).json({ ok: false, error: 'no_index' });
  const result = await cdpBridge.selectQuestionOption(index);
  res.json(result);
});

app.post('/api/actions/question/submit', async (req, res) => {
  const { isSkip } = req.body || {};
  const result = await cdpBridge.submitQuestion(!!isSkip);
  res.json(result);
});

app.post('/api/actions/click', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'no_text' });
  const result = await cdpBridge.clickButtonByText(text);
  res.json({ ok: !!result?.ok, result });
});

app.post('/api/auto-accept/toggle', async (req, res) => {
  const result = await cdpBridge.toggleAutoAccept();
  res.json({ ok: !!result?.ok, result });
});

// 2. Send Message
app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ ok: false, error: 'empty_text' });
  }

  const userMsg = {
    from: 'user',
    text: text.trim(),
    timestamp: new Date().toISOString()
  };

  STATE.messages.push(userMsg);
  saveState();
  broadcast('message_new', userMsg);

  STATE.agent.busy = true;
  STATE.agent.state = 'thinking';
  broadcast('agent_state', STATE.agent);

  const injectRes = await cdpBridge.injectMessage(userMsg.text);
  if (injectRes && injectRes.ok) {
    return res.json({ ok: true, result: injectRes });
  } else {
    STATE.outbox.push(userMsg);
    saveState();
    return res.status(500).json({ ok: false, error: injectRes ? injectRes.error || injectRes.reason : 'injection_failed' });
  }
});

// 2.1 Plan Direct Approval / Rejection
app.post('/api/plan/approve', async (req, res) => {
  const userMsg = {
    from: 'user',
    text: 'Proceed',
    timestamp: new Date().toISOString()
  };

  STATE.messages.push(userMsg);
  saveState();
  broadcast('message_new', userMsg);

  STATE.agent.busy = true;
  STATE.agent.state = 'thinking';
  broadcast('agent_state', STATE.agent);

  const injectRes = await cdpBridge.injectMessage('Proceed');
  res.json({ ok: !!(injectRes && injectRes.ok), result: injectRes });
});

app.post('/api/plan/reject', async (req, res) => {
  const feedback = (req.body.feedback || 'Please revise the implementation plan with additional details.').trim();
  const userMsg = {
    from: 'user',
    text: feedback,
    timestamp: new Date().toISOString()
  };

  STATE.messages.push(userMsg);
  saveState();
  broadcast('message_new', userMsg);

  STATE.agent.busy = true;
  STATE.agent.state = 'thinking';
  broadcast('agent_state', STATE.agent);

  const injectRes = await cdpBridge.injectMessage(feedback);
  res.json({ ok: !!(injectRes && injectRes.ok), result: injectRes });
});

// 3. Force Sync Full Chat from IDE DOM
app.post(['/api/sync-chat', '/api/chat/sync', '/api/sync'], async (req, res) => {
  const messages = await cdpBridge.syncAllMessages();
  if (messages && messages.length > 0) {
    return res.json({ ok: true, count: messages.length, messages });
  }
  res.json({ ok: true, count: STATE.messages.length, messages: STATE.messages });
});

// 4. Stop
app.post('/api/stop', async (req, res) => {
  const result = await cdpBridge.stopGeneration();
  STATE.agent.busy = false;
  STATE.agent.state = 'idle';
  broadcast('agent_state', STATE.agent);
  res.json({ ok: true, result });
});

// 5. New Chat
app.post('/api/new-chat', async (req, res) => {
  const result = await cdpBridge.startNewChat();
  STATE.messages = [];
  STATE.agent.busy = false;
  STATE.agent.state = 'idle';
  saveState();
  broadcast('history_cleared');
  res.json({ ok: true, result });
});

// 6. Model Switcher
app.get('/api/models', async (req, res) => {
  const modelsData = await cdpBridge.getModels();
  res.json({ ok: true, ...(modelsData || {}) });
});

app.post('/api/models/select', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'no_name' });
  const result = await cdpBridge.selectModel(name);
  res.json({ ok: !!result?.ok, result });
});

app.post('/api/set-model', async (req, res) => {
  const { index, name } = req.body;
  if (name) {
    const result = await cdpBridge.selectModel(name);
    return res.json({ ok: !!result?.ok, result });
  }
  const result = await cdpBridge.setModel(index || 0);
  res.json({ ok: true, result });
});

// 6.2 Workspace Management
app.get('/api/workspaces', async (req, res) => {
  try {
    const home = process.env.HOME || '/home/grem3';
    const baseDirs = [home, join(home, 'Documents')];
    const workspaces = [];
    for (const base of baseDirs) {
      try {
        const entries = await readdir(base, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
            workspaces.push({ name: e.name, path: join(base, e.name) });
          }
        }
      } catch (e) {}
    }
    res.json({ ok: true, workspaces, current: process.cwd() });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.post('/api/workspaces/open', async (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ ok: false, error: 'no_path' });
  try {
    const ideBin = process.env.ANTIGRAVITY_BIN || '/home/grem3/.local/share/antigravity/antigravity-ide';
    exec(`"${ideBin}" "${folderPath}"`, (err) => {
      console.log(`[WORKSPACE] Opened \${folderPath}`);
    });
    res.json({ ok: true, path: folderPath });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// 6.1 Remote Terminal / Quick Shell
app.post('/api/terminal/exec', (req, res) => {
  const { cmd, cwd } = req.body;
  if (!cmd || !cmd.trim()) return res.status(400).json({ ok: false, error: 'no_cmd' });
  const targetCwd = cwd || process.env.HOME || '/home/absolut7';
  exec(cmd.trim(), { cwd: targetCwd, timeout: 20000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    res.json({
      ok: !err,
      code: err ? err.code || 1 : 0,
      stdout: stdout || '',
      stderr: stderr || (err ? err.message : '')
    });
  });
});

// 7. Open Tabs
app.get('/api/tabs', async (req, res) => {
  const tabs = await cdpBridge.getOpenTabs();
  res.json(tabs);
});

app.post('/api/tabs/focus', async (req, res) => {
  const { index } = req.body;
  const result = await cdpBridge.focusTab(index || 0);
  res.json(result);
});

// 8. Live Screenshot & Desktop Lens
app.get('/api/screenshot', async (req, res) => {
  const quality = parseInt(req.query.quality || '65');
  const b64 = await cdpBridge.captureScreenshot(quality);
  if (!b64) {
    return res.status(500).json({ ok: false, error: 'screenshot_failed' });
  }
  if (req.query.raw === 'true') {
    const imgBuffer = Buffer.from(b64, 'base64');
    res.setHeader('Content-Type', 'image/jpeg');
    return res.send(imgBuffer);
  }
  res.json({ ok: true, data: b64, image: b64 });
});

// 9. Active Daemons & Background Tasks
app.get('/api/daemons', (req, res) => {
  exec('ps -eo pid,%cpu,%mem,etime,cmd --sort=-%mem | grep -E "python|node|goal|worker|daemon|ssh" | grep -v "grep"', (err, stdout) => {
    if (err) return res.json({ ok: false, daemons: [] });
    const lines = stdout.trim().split('\n');
    const daemons = lines.map(l => {
      const parts = l.trim().split(/\s+/);
      return {
        pid: parts[0],
        cpu: parts[1],
        mem: parts[2],
        etime: parts[3],
        cmd: parts.slice(4).join(' ')
      };
    }).filter(d => !d.cmd.includes('systemd'));
    res.json({ ok: true, daemons });
  });
});

app.post('/api/daemons/kill', (req, res) => {
  const { pid } = req.body;
  if (!pid) return res.status(400).json({ ok: false, error: 'no_pid' });
  exec(`kill -9 ${parseInt(pid)}`, (err) => {
    res.json({ ok: !err });
  });
});

// 10. Antigravity Specialized Features
app.get('/api/antigravity/features', async (req, res) => {
  const brainDir = join(process.env.HOME || '/home/absolut7', '.gemini', 'antigravity-ide', 'brain');
  const kiDir = join(process.env.HOME || '/home/absolut7', '.gemini', 'antigravity-ide', 'knowledge');
  
  let currentPlan = null;
  let currentWalkthrough = null;
  let activeSessionId = null;
  const knowledgeItems = [];

  try {
    const sessions = await readdir(brainDir);
    const sorted = [];
    for (const s of sessions) {
      try {
        const st = await stat(join(brainDir, s));
        if (st.isDirectory()) sorted.push({ id: s, mtime: st.mtimeMs });
      } catch (e) {}
    }
    sorted.sort((a, b) => b.mtime - a.mtime);
    if (sorted.length > 0) {
      activeSessionId = sorted[0].id;
      try {
        currentPlan = await readFile(join(brainDir, activeSessionId, 'implementation_plan.md'), 'utf-8');
      } catch (e) {}
      try {
        currentWalkthrough = await readFile(join(brainDir, activeSessionId, 'walkthrough.md'), 'utf-8');
      } catch (e) {}
    }
  } catch (e) {}

  try {
    const kis = await readdir(kiDir);
    for (const k of kis) {
      try {
        const metaRaw = await readFile(join(kiDir, k, 'metadata.json'), 'utf-8');
        const meta = JSON.parse(metaRaw);
        knowledgeItems.push({ id: k, title: meta.title || k, summary: meta.summary || '' });
      } catch (e) {
        knowledgeItems.push({ id: k, title: k, summary: '' });
      }
    }
  } catch (e) {}

  res.json({
    ok: true,
    sessionId: activeSessionId,
    currentTarget: cdpBridge.currentTarget,
    activeModel: cdpBridge.activeModelName || 'Gemini 3.7 Flash Medium',
    actions: STATE.actions,
    plan: currentPlan,
    walkthrough: currentWalkthrough,
    knowledgeItems,
    skills: [
      { name: 'agy-customizations', desc: 'Antigravity Customization Engine' },
      { name: 'antigravity-guide', desc: 'Comprehensive Antigravity Platform Guide' }
    ],
    slashCommands: [
      { cmd: '/goal', title: 'Overnight Goal Mode', desc: 'Runs long-running tasks autonomously until achieved' },
      { cmd: '/schedule', title: 'Timer & Cron Scheduler', desc: 'One-shot reminders and recurring cron loops' },
      { cmd: '/grill-me', title: 'Interactive Interview', desc: 'Architectural alignment & requirement drill-down' },
      { cmd: '/learn', title: 'Learn & Persist', desc: 'Saves patterns and corrections to persistent agent memory' },
      { cmd: '/compact', title: 'Compact Context', desc: 'Prunes conversation tokens while preserving state' },
      { cmd: '/review', title: 'Code Review', desc: 'Security, performance, and best practices audit' }
    ]
  });
});

app.get('/api/knowledge/:id', async (req, res) => {
  const { id } = req.params;
  const kiPath = join(process.env.HOME || '/home/absolut7', '.gemini', 'antigravity-ide', 'knowledge', id);
  try {
    const metaRaw = await readFile(join(kiPath, 'metadata.json'), 'utf-8');
    const meta = JSON.parse(metaRaw);
    let overview = '';
    try {
      overview = await readFile(join(kiPath, 'artifacts', 'overview.md'), 'utf-8');
    } catch (e) {}
    res.json({ ok: true, id, meta, overview });
  } catch (e) {
    res.status(404).json({ ok: false, error: 'not_found' });
  }
});

// 11. Stats, Status, History, Upload
app.get('/api/stats', (req, res) => res.json({ ok: true, stats: getSystemStats() }));
app.get('/api/state', (req, res) => {
  res.json({
    ok: true,
    messages: STATE.messages,
    agent: STATE.agent,
    actions: STATE.actions,
    stats: getSystemStats(),
    target: cdpBridge.currentTarget,
    cdpConnected: cdpBridge.connected
  });
});

app.get('/api/status', (req, res) => res.json({ ok: true, cdp: cdpBridge.connected ? 'connected' : 'not_connected', target: cdpBridge.currentTarget, agent: STATE.agent, actions: STATE.actions, stats: getSystemStats() }));

app.get('/api/history', async (req, res) => {
  try {
    const ideHistory = await cdpBridge.getChatHistory();
    if (ideHistory?.ok && ideHistory?.chats?.length > 0) {
      return res.json({
        ok: true,
        source: 'ide_cdp',
        sessions: ideHistory.chats.map(c => ({
          id: c.id,
          title: c.title,
          subtitle: c.workspace ? `${c.workspace} • ${c.date}` : c.date,
          active: !!c.isSelected
        }))
      });
    }
  } catch (e) {}

  // Fallback to local brain dir if CDP history is empty
  const brainDir = join(process.env.HOME || '/home/grem3', '.gemini', 'antigravity-ide', 'brain');
  const sessions = [];
  try {
    const entries = await readdir(brainDir);
    for (const entry of entries) {
      const fullPath = join(brainDir, entry);
      try {
        const st = await stat(fullPath);
        if (st.isDirectory() && entry.length >= 8) {
          let title = 'Session ' + entry.slice(0, 8);
          try {
            const planRaw = await readFile(join(fullPath, 'implementation_plan.md'), 'utf-8');
            const firstLine = planRaw.split('\n').find(l => l.startsWith('# '));
            if (firstLine) title = firstLine.replace('# ', '').trim();
          } catch (e) {}
          sessions.push({ id: entry, title, subtitle: new Date(st.mtime).toLocaleString(), mtimeMs: st.mtimeMs });
        }
      } catch (e) {}
    }
  } catch (e) {}
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  res.json({ ok: true, source: 'brain_fs', sessions: sessions.slice(0, 30) });
});

app.post('/api/select-chat', async (req, res) => {
  const { id, title } = req.body || {};
  if (!id && !title) return res.status(400).json({ ok: false, error: 'no_id_or_title' });

  const result = await cdpBridge.selectChat(id, title);
  if (result?.ok) {
    // Reset state & trigger message sync
    STATE.messages = [];
    saveState();
    broadcast('history_cleared');
    setTimeout(async () => {
      const messages = await cdpBridge.syncAllMessages();
      if (messages?.length) {
        STATE.messages = messages;
        saveState();
        broadcast('init_state', { messages: STATE.messages, agent: STATE.agent });
      }
    }, 600);
  }
  res.json(result);
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'no_file' });
  const isImage = req.file.mimetype.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(req.file.originalname);
  res.json({
    ok: true,
    file: {
      originalName: req.file.originalname,
      path: req.file.path,
      size: req.file.size,
      isImage: isImage
    }
  });
});

// ----------------------------------------------------------------------
// WebSocket
// ----------------------------------------------------------------------
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', async (ws) => {
  // init state directly from memory
  ws.send(JSON.stringify({
    event: 'init_state',
    payload: {
      messages: STATE.messages,
      agent: STATE.agent,
      actions: STATE.actions,
      stats: getSystemStats()
    }
  }));
});

async function main() {
  await loadState();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 GRAVITYR3 RUNNING ON PORT ${PORT} [TARGET: ${cdpBridge.currentTarget.toUpperCase()}]`);
    cdpBridge.connect();
  });
}

main();
