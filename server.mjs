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

const upload = multer({ dest: UPLOAD_DIR });

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
    ram: { usedMb, totalMb, percent: ramPercent },
    uptimeSec: Math.round(uptime()),
    clients: wss.clients.size,
    cdpConnected: cdpBridge.connected,
    currentTarget: cdpBridge.currentTarget,
    agentBusy: STATE.agent.busy,
    autoAccept: STATE.actions.autoAccept
  };
}

setInterval(() => {
  if (wss.clients.size > 0) {
    broadcast('telemetry_tick', getSystemStats());
  }
}, 2500);

cdpBridge.onNewMessage = (msg) => {
  const last = STATE.messages[STATE.messages.length - 1];
  if (!last || last.text !== msg.text || last.from !== msg.from) {
    STATE.messages.push(msg);
    if (STATE.messages.length > 300) STATE.messages.shift();
    saveState();
    broadcast('message_new', msg);
  }
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
app.post('/api/sync-chat', async (req, res) => {
  const domRes = await cdpBridge.evaluate(`(() => {
    const articles = Array.from(document.querySelectorAll('div[role="article"]'));
    return articles.map(a => {
      const label = a.getAttribute('aria-label') || '';
      const isUser = label.includes('User');
      const isAgent = label.includes('Agent') || label.includes('response') || !isUser;
      
      let cleanText = '';
      if (isUser) {
        let rawUserText = a.innerText ? a.innerText.trim() : '';
        const lines = rawUserText.split('\\n');
        if (lines.length > 1 && /^\\d{1,2}:\\d{2}\\s*(AM|PM)?$/i.test(lines[lines.length - 1].trim())) {
          rawUserText = lines.slice(0, -1).join('\\n').trim();
        }
        cleanText = rawUserText;
      } else {
        const textNodes = Array.from(a.querySelectorAll('.leading-relaxed.select-text, .rendered-markdown, .prose'));
        const toolNodes = Array.from(a.querySelectorAll('div[class*=\"run-command\"], div[class*=\"group/run-command\"]'));
        
        cleanText = textNodes.map(t => t.innerText.trim()).filter(Boolean).join('\\n\\n');
        if (cleanText.startsWith('Worked for ') || cleanText.startsWith('Thought for ')) {
          const parts = cleanText.split('\\n\\n');
          if (parts.length > 1) cleanText = parts.slice(1).join('\\n\\n');
        }
        if (!cleanText && toolNodes.length > 0) {
          const cmdPreview = toolNodes[0].innerText.trim().slice(0, 200);
          cleanText = '> ⚡ Running Tool:\\n\`\`\`bash\\n' + cmdPreview + '\\n\`\`\`';
        }
        if (!cleanText && a.innerText) {
          let fallback = a.innerText.trim();
          if (fallback.startsWith('Thought for ') || fallback.startsWith('Worked for ')) {
            const parts = fallback.split('\\n\\n');
            if (parts.length > 1) fallback = parts.slice(1).join('\\n\\n');
          }
          cleanText = fallback;
        }
      }

      return {
        from: isAgent ? 'agent' : 'user',
        text: cleanText,
        timestamp: new Date().toISOString()
      };
    }).filter(m => m.text.length > 0);
  })()`);

  if (domRes && Array.isArray(domRes)) {
    STATE.messages = domRes;
    saveState();
    broadcast('init_state', {
      messages: STATE.messages,
      agent: STATE.agent,
      actions: STATE.actions,
      stats: getSystemStats()
    });
    return res.json({ ok: true, count: STATE.messages.length });
  }
  res.json({ ok: false, error: 'sync_failed' });
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
  res.json({ ok: true, data: b64 });
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
app.get('/api/status', (req, res) => res.json({ ok: true, cdp: cdpBridge.connected ? 'connected' : 'not_connected', target: cdpBridge.currentTarget, agent: STATE.agent, actions: STATE.actions, stats: getSystemStats() }));

app.get('/api/history', async (req, res) => {
  const brainDir = join(process.env.HOME || '/home/absolut7', '.gemini', 'antigravity-ide', 'brain');
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
          sessions.push({ id: entry, title, modified: st.mtime.toISOString(), mtimeMs: st.mtimeMs });
        }
      } catch (e) {}
    }
  } catch (e) {}
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  res.json({ ok: true, sessions: sessions.slice(0, 30) });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'no_file' });
  res.json({ ok: true, file: { originalName: req.file.originalname, path: req.file.path, size: req.file.size } });
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
  await cdpBridge.syncAllMessages();
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
    console.log(`🚀 GRAVITYREM3 RUNNING ON PORT ${PORT} [TARGET: ${cdpBridge.currentTarget.toUpperCase()}]`);
    cdpBridge.connect();
  });
}

main();
