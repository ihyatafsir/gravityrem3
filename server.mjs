import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import https from 'https';
import { networkInterfaces, cpus, totalmem, freemem, uptime, homedir } from 'os';
import { mkdir, readFile, writeFile, rename, readdir, stat } from 'fs/promises';
import fs from 'fs';
import { join, dirname, basename, resolve as pathResolve } from 'path';
import { fileURLToPath } from 'url';
import { exec, spawn } from 'child_process';
import multer from 'multer';
import { cdpBridge } from './cdp_bridge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8787');
const DATA_DIR = join(__dirname, 'data');
const STATE_FILE = join(DATA_DIR, 'state.json');
const UPLOAD_DIR = '/tmp/ag_uploads';

// ----------------------------------------------------------------------
// Antigravity CLI (agy) integration — Gemini 4 is only reachable through
// the CLI, never the IDE, so prompts for it are routed to `agy --print`.
// ----------------------------------------------------------------------
const HOME_DIR = process.env.HOME || homedir();
const AGY_BIN = process.env.AGY_BIN || join(HOME_DIR, '.local', 'bin', 'agy');
const AGY_SETTINGS_FILE = join(HOME_DIR, '.gemini', 'antigravity-cli', 'settings.json');
const AGY_RUN_DIR = join(HOME_DIR, '.gemini', 'antigravity-cli');
// Gemini 4 (Argon) — CLI only. Keyed by the model id agy accepts via --model.
const AGY_MODELS = {
  'gemini-4-high': { label: 'Gemini 4 (High)', effort: 'high', cliId: 'gemini-4-argon-high' },
  'gemini-4-medium': { label: 'Gemini 4 (Medium)', effort: 'medium', cliId: 'gemini-4-argon-medium' },
  'gemini-4-low': { label: 'Gemini 4 (Low)', effort: 'low', cliId: 'gemini-4-argon-low' },
  'gemini-4-argon-high': { label: 'Gemini 4 Argon High', effort: 'high', cliId: 'gemini-4-argon-high' },
  'gemini-4-argon-medium': { label: 'Gemini 4 Argon Medium', effort: 'medium', cliId: 'gemini-4-argon-medium' },
  'gemini-4-argon-low': { label: 'Gemini 4 Argon Low', effort: 'low', cliId: 'gemini-4-argon-low' }
};

async function readAgySettings() {
  try {
    const raw = await readFile(AGY_SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

async function overageStatus() {
  const settings = await readAgySettings();
  return {
    ok: true,
    useG1Credits: settings.useG1Credits === true,
    settingsFile: AGY_SETTINGS_FILE,
    settingsPresent: fs.existsSync(AGY_SETTINGS_FILE),
    available: fs.existsSync(AGY_BIN)
  };
}

// Toggles the paid-credit overage flag the CLI reads (Go field `useG1Credits`).
async function setOverage(enabled) {
  await mkdir(dirname(AGY_SETTINGS_FILE), { recursive: true });
  const settings = await readAgySettings();
  settings.useG1Credits = !!enabled;
  const tempFile = `${AGY_SETTINGS_FILE}.tmp`;
  await writeFile(tempFile, JSON.stringify(settings, null, 2));
  await rename(tempFile, AGY_SETTINGS_FILE);
  const status = await overageStatus();
  broadcast('overage_state', status);
  return status;
}

// Runs a single non-interactive `agy --print` turn and resolves with its output.
function runAgyPrompt(promptText, modelId, timeoutMs = 180000) {
  return new Promise((resolve) => {
    if (!fs.existsSync(AGY_BIN)) {
      return resolve({ ok: false, error: `agy binary not found at ${AGY_BIN}` });
    }
    const args = ['--print', promptText];
    const resolvedModel = AGY_MODELS[modelId]?.cliId || modelId;
    if (resolvedModel) args.unshift('--model', resolvedModel);

    const child = spawn(AGY_BIN, args, {
      cwd: AGY_RUN_DIR,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill('SIGKILL'); } catch (e) {}
        resolve({ ok: false, error: `agy timed out after ${Math.round(timeoutMs / 1000)}s`, stdout, stderr, timedOut: true });
      }
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: `failed to launch agy: ${err.message}` });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = (stdout || '').trim();
      const errText = (stderr || '').trim();
      const combined = errText + ' ' + text;
      // Two distinct walls: no entitlement vs no wallet balance.
      const lowCredit = /credits balance is too low|insufficient credit|no credits|credit balance/i.test(combined);
      const quotaMatch = combined.match(/Individual quota reached[^\n]*|quota reached[^\n]*|RESOURCE_EXHAUSTED[^\n]*/i);
      const failed = code !== 0 || /^AGY_ERROR:/.test(text) || /^error:/m.test(errText) || /^error:/m.test(text);
      resolve({
        ok: !failed,
        code,
        text: failed ? (text || errText) : text,
        stdout: text,
        stderr: errText,
        lowCredit,
        quota: quotaMatch ? quotaMatch[0] : null
      });
    });
  });
}

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

// Broadcast high-fidelity live snapshot updates to mobile clients
cdpBridge.onSnapshotUpdate = (snapshot) => {
  broadcast('snapshot_update', {
    hash: snapshot.hash,
    stats: snapshot.stats,
    isAgentBusy: snapshot.isAgentBusy
  });
};

// ----------------------------------------------------------------------
// REST API Routes
// ----------------------------------------------------------------------

// ----------------------------------------------------------------------
// GravityRemote2 High-Fidelity Snapshot & Remote-Click Endpoints
// ----------------------------------------------------------------------

// 0.0 High-Fidelity Snapshot Endpoint
app.get(['/api/snapshot', '/snapshot'], async (req, res) => {
  const force = req.query.fresh === '1' || req.query.force === 'true';
  let snap = await cdpBridge.captureSnapshot(force);
  if (!snap) snap = cdpBridge.lastSnapshot;
  if (!snap) {
    return res.status(503).json({ ok: false, error: 'No snapshot available yet' });
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(snap);
});

// 0.1 Remote Interactive Click (Expands/Collapses Tool Steps, Commands, Thoughts in IDE)
app.post(['/api/remote-click', '/remote-click'], async (req, res) => {
  const { remoteId, selector, index, textContent, testId, ariaLabel, tagName } = req.body || {};
  const result = await cdpBridge.clickElement({ remoteId, selector, index, textContent, testId, ariaLabel, tagName });
  
  // Immediately refresh snapshot so client gets latest DOM with toggled state
  try {
    await cdpBridge.captureSnapshot(true);
  } catch(e) {}
  
  setTimeout(() => cdpBridge.captureSnapshot(true), 150);
  setTimeout(() => cdpBridge.captureSnapshot(true), 400);
  setTimeout(() => cdpBridge.captureSnapshot(true), 800);
  res.json(result);
});

// 0.2 Sovereign Mobile File Viewer Endpoints
function resolveFilePath(rawPath) {
  if (!rawPath) return null;
  let cleanPath = rawPath.trim();
  if (cleanPath.startsWith('file://')) cleanPath = cleanPath.slice(7);
  cleanPath = cleanPath.split('#')[0].split('?')[0];

  if (fs.existsSync(cleanPath)) {
    try {
      if (fs.statSync(cleanPath).isFile()) return cleanPath;
    } catch(e) {}
  }

  const candidateRoots = [
    join(homedir(), '.gemini/antigravity-ide/brain'),
    join(homedir(), 'Documents/26apps/gravityrem3'),
    join(homedir(), 'Documents/26apps/gravityremote2'),
    join(homedir(), 'Documents'),
    homedir()
  ];

  for (const root of candidateRoots) {
    const full = join(root, cleanPath);
    if (fs.existsSync(full)) {
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch(e) {}
    }
  }

  const targetBase = basename(cleanPath);
  if (targetBase) {
    for (const root of candidateRoots) {
      try {
        const found = searchFileShallow(root, targetBase, 3);
        if (found) return found;
      } catch(e) {}
    }
  }

  return null;
}

function searchFileShallow(dir, targetName, maxDepth = 3) {
  if (maxDepth < 0 || !fs.existsSync(dir)) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.gemini') continue;
      if (entry.name === 'node_modules') continue;
      const fullPath = join(dir, entry.name);
      if (entry.isFile() && entry.name === targetName) {
        return fullPath;
      }
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.gemini') continue;
      if (entry.name === 'node_modules') continue;
      if (entry.isDirectory()) {
        const res = searchFileShallow(join(dir, entry.name), targetName, maxDepth - 1);
        if (res) return res;
      }
    }
  } catch(e) {}
  return null;
}

app.get('/api/file/view', (req, res) => {
  const rawPath = req.query.path || req.query.file;
  if (!rawPath) return res.status(400).json({ ok: false, error: 'File path required' });

  const resolved = resolveFilePath(rawPath);
  if (!resolved) {
    return res.status(404).json({ ok: false, error: `File not found: ${rawPath}` });
  }

  try {
    const fileStat = fs.statSync(resolved);
    const name = basename(resolved);
    const ext = name.split('.').pop().toLowerCase();
    const isImage = /^(jpe?g|png|gif|webp|svg|bmp|ico)$/i.test(ext);
    const isMarkdown = /^(md|markdown|mdown|mkdn)$/i.test(ext);
    const isCode = /^(py|js|ts|jsx|tsx|html|css|json|cpp|c|h|rs|go|sh|bash|java|kt|php|rb|sql|yaml|yml|xml|toml|ini|env)$/i.test(ext);

    if (fileStat.size > 2 * 1024 * 1024) {
      return res.json({
        ok: true,
        success: true,
        name,
        path: resolved,
        size: fileStat.size,
        truncated: true,
        isImage: false,
        isMarkdown: false,
        isCode: true,
        content: 'File is too large to preview (> 2MB). Use download button.'
      });
    }

    if (isImage) {
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : 'image/jpeg';
      const base64 = fs.readFileSync(resolved).toString('base64');
      return res.json({
        ok: true,
        success: true,
        name,
        path: resolved,
        size: fileStat.size,
        isImage: true,
        isMarkdown: false,
        isCode: false,
        dataUrl: `data:${mime};base64,${base64}`
      });
    }

    const content = fs.readFileSync(resolved, 'utf8');
    res.json({
      ok: true,
      success: true,
      name,
      path: resolved,
      size: fileStat.size,
      isImage: false,
      isMarkdown,
      isCode,
      content
    });
  } catch(err) {
    res.status(500).json({ ok: false, error: `Failed to read file: ${err.message}` });
  }
});

app.get('/api/file/raw', (req, res) => {
  const rawPath = req.query.path || req.query.file;
  if (!rawPath) return res.status(400).send('File path required');
  const resolved = resolveFilePath(rawPath);
  if (!resolved) return res.status(404).send(`File not found: ${rawPath}`);
  res.sendFile(resolved);
});

app.get('/api/file/download', (req, res) => {
  const rawPath = req.query.path || req.query.file;
  if (!rawPath) return res.status(400).send('File path required');
  const resolved = resolveFilePath(rawPath);
  if (!resolved) return res.status(404).send(`File not found: ${rawPath}`);
  res.download(resolved, basename(resolved));
});

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
  let { text, model, mode } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ ok: false, error: 'invalid_message' });
  }

  const rawUserText = text.trim();
  let promptToInject = rawUserText;

  const activeModelStr = (model || STATE.activeModel || '').toLowerCase();
  if ((activeModelStr.includes('high') || activeModelStr.includes('thinking')) && !promptToInject.includes('[Thinking Effort:')) {
    promptToInject = `[Thinking Effort: High (1.00)] ${promptToInject}`;
  } else if (activeModelStr.includes('low') && !promptToInject.includes('[Thinking Effort:')) {
    promptToInject = `[Thinking Effort: Low (0.10)] ${promptToInject}`;
  } else if (activeModelStr.includes('medium') && !promptToInject.includes('[Thinking Effort:')) {
    promptToInject = `[Thinking Effort: Medium (0.50)] ${promptToInject}`;
  }

  if (mode === 'plan' && !promptToInject.startsWith('/plan') && !promptToInject.includes('[Planning Mode]')) {
    promptToInject = `[Planning Mode Enabled] ${promptToInject}`;
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

  const injectRes = await cdpBridge.injectMessage(promptToInject);
  if (injectRes && injectRes.ok) {
    // GravityRemote2 Post-Send Burst Snapshot captures
    setTimeout(() => cdpBridge.captureSnapshot(true), 300);
    setTimeout(() => cdpBridge.captureSnapshot(true), 800);
    setTimeout(() => cdpBridge.captureSnapshot(true), 2000);
    setTimeout(() => cdpBridge.captureSnapshot(true), 4000);
    setTimeout(() => cdpBridge.captureSnapshot(true), 7000);

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
  if (/argon|gemini[\s-]*4\b/i.test(name)) {
    cdpBridge.activeModelName = name;
    STATE.activeModel = name;
    saveState();
    return res.json({ ok: true, selected: name, cli: true });
  }
  const result = await cdpBridge.selectModel(name);
  if (result?.ok) {
    STATE.activeModel = name;
    saveState();
  }
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

// 10b. Lisan al-Arab API
let _lisanData = null;
const DEFAULT_LISAN_SENTENCES = [
  "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
  "اقْرَأْ بِاسْمِ رَبِّكَ الَّذِي خَلَقَ",
  "خَلَقَ الْإِنسَانَ مِنْ عَلَقٍ",
  "اقْرَأْ وَرَبُّكَ الْأَكْرَمُ",
  "الَّذِي عَلَّمَ بِالْقَلَمِ",
  "عَلَّمَ الْإِنسَانَ مَا لَمْ يَعْلَمْ",
  "الَّذِي يَرَ الْيَقِينُ مِفَتَاحُ الْفَرَجِ",
  "الْعِلْمُ نُورٌ وَالْجَهْلُ ظَلَامٌ",
  "كُنْ مَعَ اللَّهِ تَرَ اللَّهَ مَعَكَ",
  "الصَّبْرُ مِفْتَاحُ الْفَرَجِ"
];

app.get('/api/lisan', (req, res) => {
  try {
    const lisanPath = join(__dirname, 'data', 'lisanclean.json');
    if (fs.existsSync(lisanPath)) {
      if (!_lisanData) {
        const raw = JSON.parse(fs.readFileSync(lisanPath, 'utf-8'));
        _lisanData = Object.keys(raw);
      }
      const roots = _lisanData;
      if (roots && roots.length > 5) {
        const sentences = [];
        for (let i = 0; i < 50; i++) {
          const start = Math.floor(Math.random() * (roots.length - 4));
          const count = 3 + Math.floor(Math.random() * 3);
          sentences.push(roots.slice(start, start + count).join(' '));
        }
        return res.json(sentences);
      }
    }
  } catch (e) {
    console.error('Lisan API error:', e.message);
  }
  res.json(DEFAULT_LISAN_SENTENCES);
});

// 10c. Paid AI-credit overage (bypasses the weekly per-model quota wall)
app.get('/api/overage', async (req, res) => {
  res.json(await overageStatus());
});

app.post('/api/overage', async (req, res) => {
  const body = req.body || {};
  let enabled = body.enabled;
  if (typeof enabled !== 'boolean') {
    const current = await overageStatus();
    enabled = !current.useG1Credits;
  }
  try {
    const status = await setOverage(enabled);
    console.log(`[OVERAGE] useG1Credits=${status.useG1Credits}`);
    res.json(status);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 10d. Gemini 4 via the agy CLI (Gemini 4 is not available through the IDE)
app.get('/api/agy/models', (req, res) => {
  res.json({
    ok: true,
    agyPath: AGY_BIN,
    available: fs.existsSync(AGY_BIN),
    models: Object.entries(AGY_MODELS).map(([id, meta]) => ({ id, ...meta }))
  });
});

app.post(['/api/agy/prompt', '/api/gm4/prompt'], async (req, res) => {
  const { text, model } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ ok: false, error: 'invalid_message' });
  }
  const modelId = AGY_MODELS[model] ? model : 'gemini-4-argon-high';
  const promptText = text.trim();

  const userMsg = { from: 'user', text: promptText, timestamp: new Date().toISOString(), via: 'agy' };
  STATE.messages.push(userMsg);
  saveState();
  broadcast('message_new', userMsg);

  STATE.agent.busy = true;
  STATE.agent.state = 'executing';
  broadcast('agent_state', STATE.agent);

  const result = await runAgyPrompt(promptText, modelId);

  let agentMsg;
  if (result.ok) {
    agentMsg = {
      from: 'agent',
      text: result.stdout || '(no output)',
      timestamp: new Date().toISOString(),
      via: 'agy',
      model: AGY_MODELS[modelId].label
    };
  } else {
    const detail = result.lowCredit
      ? 'Overage is ON, but your AI credits balance is too low to cover this turn.\n\nBuy credits: https://antigravity.google/g1-credits'
      : result.quota
        ? `Quota wall: ${result.quota}\n\nEnable paid overage (AI credits) in the Models tab, or wait for the bucket to refill.`
        : (result.error || result.stderr || result.text || 'agy run failed');
    agentMsg = {
      from: 'agent',
      text: `⚠️ agy (${AGY_MODELS[modelId].label}) could not complete this turn.\n\n${detail}`,
      timestamp: new Date().toISOString(),
      via: 'agy',
      error: true,
      model: AGY_MODELS[modelId].label
    };
  }

  STATE.messages.push(agentMsg);
  saveState();
  broadcast('message_new', agentMsg);

  STATE.agent.busy = false;
  STATE.agent.state = 'idle';
  STATE.agent.lastActive = new Date().toISOString();
  broadcast('agent_state', STATE.agent);

  res.json({ ok: result.ok, model: modelId, result });
});

// 10e. Quota and limits telemetry
function formatMsDuration(ms) {
  if (ms <= 0) return 'Reset reached';
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

let cachedLiveQuota = null;
let lastLiveQuotaFetch = 0;

async function fetchLiveQuotaFromLS() {
  const now = Date.now();
  if (cachedLiveQuota && (now - lastLiveQuotaFetch < 5000)) {
    return cachedLiveQuota;
  }
  try {
    const { execSync } = await import('child_process');

    const pids = execSync('pgrep -f language_server_linux_x64', { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);

    for (const pid of pids) {
      try {
        const cmdline = execSync(`cat /proc/${pid}/cmdline`, { encoding: 'utf8' }).replace(/\0/g, ' ');
        const tokenMatch = cmdline.match(/--csrf_token\s+([a-f0-9-]+)/i) || cmdline.match(/--csrf_token=([a-f0-9-]+)/i);
        if (!tokenMatch) continue;
        const csrfToken = tokenMatch[1];

        const ssOut = execSync(`ss -tulpn -H 2>/dev/null | grep "pid=${pid},"`, { encoding: 'utf8' });
        const ports = [];
        for (const line of ssOut.split('\n')) {
          const m = line.match(/127\.0\.0\.1:(\d+)/);
          if (m) {
            const port = parseInt(m[1], 10);
            if (port !== 9222 && !ports.includes(port)) ports.push(port);
          }
        }

        for (const port of ports) {
          try {
            const res = await new Promise((resolve, reject) => {
              const req = https.request({
                hostname: '127.0.0.1',
                port,
                path: '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-codeium-csrf-token': csrfToken
                },
                rejectUnauthorized: false,
                timeout: 1500
              }, (resp) => {
                let data = '';
                resp.on('data', chunk => data += chunk);
                resp.on('end', () => {
                  if (resp.statusCode === 200) {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                  } else { reject(new Error('Status ' + resp.statusCode)); }
                });
              });
              req.on('error', reject);
              req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
              req.write('{}');
              req.end();
            });

            if (res && res.response && res.response.groups) {
              const groups = res.response.groups.map(g => ({
                displayName: g.displayName,
                description: g.description,
                buckets: (g.buckets || []).map(b => ({
                  bucketId: b.bucketId,
                  displayName: b.displayName,
                  window: b.window,
                  remainingFraction: b.remainingFraction,
                  percentage: typeof b.remainingFraction === 'number' ? Math.round(b.remainingFraction * 100) : 100,
                  resetTime: b.resetTime,
                  description: b.description
                }))
              }));

              const geminiGroup = groups.find(g => g.displayName.toLowerCase().includes('gemini')) || groups[0];
              const geminiWeekly = geminiGroup?.buckets.find(b => b.window === 'weekly' || b.bucketId.includes('weekly'));
              const geminiDaily = geminiGroup?.buckets.find(b => b.window === '5h' || b.bucketId.includes('5h') || b.bucketId.includes('daily'));

              cachedLiveQuota = {
                fetchedAt: new Date().toISOString(),
                groups,
                summaryText: res.response.description,
                dailyPercentLeft: geminiDaily ? geminiDaily.percentage : 100,
                weeklyPercentLeft: geminiWeekly ? geminiWeekly.percentage : 100,
                dailyResetTime: geminiDaily ? geminiDaily.resetTime : null,
                weeklyResetTime: geminiWeekly ? geminiWeekly.resetTime : null,
                geminiDailyDesc: geminiDaily ? geminiDaily.description : null,
                geminiWeeklyDesc: geminiWeekly ? geminiWeekly.description : null
              };
              lastLiveQuotaFetch = now;
              return cachedLiveQuota;
            }
          } catch (e) {}
        }
      } catch (err) {}
    }
  } catch (e) {}
  return cachedLiveQuota;
}

async function getQuotaStatus() {
  const logBase = join(HOME_DIR, '.config', 'Antigravity IDE', 'logs');
  function findLsMainFiles(dir) {
    let results = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          results = results.concat(findLsMainFiles(full));
        } else if (e.name.includes('ls-main')) {
          results.push(full);
        }
      }
    } catch (e) {}
    return results;
  }

  const files = findLsMainFiles(logBase);
  const filesWithStats = files.map(f => {
    try {
      const s = fs.statSync(f);
      return { path: f, mtime: s.mtimeMs, name: basename(f) };
    } catch (e) {
      return { path: f, mtime: 0, name: basename(f) };
    }
  });
  filesWithStats.sort((a,b) => b.mtime - a.mtime);
  const activeLogObj = filesWithStats.find(f => f.name === 'ls-main.log') || filesWithStats[0];

  let activeLogContent = '';
  if (activeLogObj) {
    try { activeLogContent = fs.readFileSync(activeLogObj.path, 'utf8'); } catch (e) {}
  }

  const lastSuccessMatch = Array.from(activeLogContent.matchAll(/(20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}).*?streamGenerateContent.*?ResponseID:\s*([^\s\n]+)/g)).pop();
  const lastActiveErrorMatch = Array.from(activeLogContent.matchAll(/(20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}).*?(RESOURCE_EXHAUSTED.*?|Individual quota reached.*?|exhausted your capacity.*?|No capacity available.*?)(?:\n|$)/gi)).pop();

  const isCurrentlyHealthy = !lastActiveErrorMatch || (lastSuccessMatch && lastSuccessMatch[1] > lastActiveErrorMatch[1]);

  const regex = /(20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}).*?(RESOURCE_EXHAUSTED.*?|Individual quota reached.*?|exhausted your capacity.*?|No capacity available.*?)(?:\n|$)/gi;
  let allMatches = [];
  for (const f of files) {
    try {
      const content = fs.readFileSync(f, 'utf8');
      let m;
      while ((m = regex.exec(content)) !== null) {
        allMatches.push({ file: basename(f), time: m[1], line: m[0].trim() });
      }
    } catch (e) {}
  }
  allMatches.sort((a,b) => a.time.localeCompare(b.time));

  let resetInfo = null;
  let isExhausted = !isCurrentlyHealthy;

  const relevantError = !isCurrentlyHealthy ? lastActiveErrorMatch : null;
  if (relevantError) {
    const errorLine = relevantError[0];
    const resetMatch = errorLine.match(/(?:Resets in|reset after)\s+([0-9hms.]+)/i);
    if (resetMatch) {
      const str = resetMatch[1];
      let totalMs = 0;
      const h = str.match(/(\d+)h/i);
      const m = str.match(/(\d+)m/i);
      const s = str.match(/(\d+)s/i);
      if (h) totalMs += parseInt(h[1]) * 3600 * 1000;
      if (m) totalMs += parseInt(m[1]) * 60 * 1000;
      if (s) totalMs += parseInt(s[1]) * 1000;

      const eventDate = new Date(relevantError[1].replace(' ', 'T'));
      const resetDate = new Date(eventDate.getTime() + totalMs);
      const remainingMs = resetDate.getTime() - Date.now();

      resetInfo = {
        originalDuration: str,
        eventTime: relevantError[1],
        resetTimestamp: resetDate.toISOString(),
        resetDateFormatted: resetDate.toLocaleString('en-US', { timeZoneName: 'short' }),
        remainingMs: remainingMs,
        remainingFormatted: remainingMs > 0 ? formatMsDuration(remainingMs) : 'Reset reached'
      };
      if (remainingMs <= 0) {
        isExhausted = false;
      }
    }
  }

  const [overage, liveQuota] = await Promise.all([
    overageStatus(),
    fetchLiveQuotaFromLS()
  ]);

  return {
    isExhausted,
    status: isExhausted ? 'exhausted' : 'operational',
    activeLogFile: activeLogObj ? activeLogObj.name : null,
    lastSuccessTime: lastSuccessMatch ? lastSuccessMatch[1] : null,
    lastResponseId: lastSuccessMatch ? lastSuccessMatch[2] : null,
    activeModel: cdpBridge.activeModelName || 'Gemini 4 (High)',
    latestActiveError: relevantError ? { time: relevantError[1], line: relevantError[0].trim() } : null,
    resetInfo,
    recentEvents: allMatches.slice(-8).reverse().map(e => ({
      ...e,
      resolved: isCurrentlyHealthy || (lastSuccessMatch && lastSuccessMatch[1] > e.time)
    })),
    overage,
    liveQuota,
    dailyPercentLeft: liveQuota?.dailyPercentLeft ?? 100,
    weeklyPercentLeft: liveQuota?.weeklyPercentLeft ?? 100,
    dailyResetTime: liveQuota?.dailyResetTime ?? null,
    weeklyResetTime: liveQuota?.weeklyResetTime ?? null,
    geminiDailyDesc: liveQuota?.geminiDailyDesc ?? null,
    geminiWeeklyDesc: liveQuota?.geminiWeeklyDesc ?? null,
    serverTime: new Date().toISOString()
  };
}

app.get('/api/quota', async (req, res) => {
  try {
    const q = await getQuotaStatus();
    res.json({ ok: true, ...q });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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
  if (cdpBridge.lastSnapshot) {
    try {
      ws.send(JSON.stringify({
        event: 'snapshot_update',
        payload: {
          hash: cdpBridge.lastSnapshot.hash,
          stats: cdpBridge.lastSnapshot.stats,
          isAgentBusy: cdpBridge.lastSnapshot.isAgentBusy
        }
      }));
    } catch(e) {}
  }
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
