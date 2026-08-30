import WebSocket from 'ws';
import http from 'http';

let ACTIVE_TARGET = 'vm';
let CDP_PORT = ACTIVE_TARGET === 'vm' ? 9222 : 9223;
const DEBUG = process.env.DEBUG === 'true';

function log(...args) {
  console.log('[CDP-BRIDGE]', ...args);
}

function debugLog(...args) {
  if (DEBUG) console.log('[CDP-DEBUG]', ...args);
}

const EXPRESSION_CHECK_LAST_MESSAGE = `(() => {
  const articles = Array.from(document.querySelectorAll('div[role="article"]'));
  if (!articles.length) return null;
  const a = articles[articles.length - 1];

  let thought = '';
  const thoughtBtn = a.querySelector('button[class*="tabular-nums"]');
  if (thoughtBtn && thoughtBtn.innerText) {
    const tText = thoughtBtn.innerText.trim();
    if (/^(?:Thought for|Worked for|Thinking)/i.test(tText)) {
      thought = tText;
    }
  }

  let cmd = '';
  const toolStepNodes = Array.from(a.querySelectorAll('div.w-full.my-0.5, button[class*="tabular-nums"], div[class*="run-command"], div[class*="group/run-command"], div[class*="terminal"], div[class*="tool-invocation"]'));
  const toolSteps = toolStepNodes
    .map(tn => tn.innerText.trim())
    .filter(t => t && !/^(?:Thought for|Worked for|Thinking)/i.test(t));

  if (toolSteps.length > 0) {
    // Deduplicate consecutive steps
    const deduped = toolSteps.filter((s, i, arr) => i === 0 || s !== arr[i-1]);
    cmd = String.fromCharCode(96,96,96) + "bash\n" + deduped.join("\n") + "\n" + String.fromCharCode(96,96,96);
  }

  let answer = '';
  const textNodes = Array.from(a.querySelectorAll('div.leading-relaxed.select-text, div.rendered-markdown, div.prose'))
    .filter(el => !el.closest('button[class*="tabular-nums"], div.w-full.my-0.5, div[class*="run-command"], div[class*="terminal"]'));

  if (textNodes.length > 0) {
    answer = textNodes.map(t => t.innerText.trim()).filter(Boolean).join('\n\n');
  }

  let fullText = '';
  if (thought) fullText += thought + '\n\n';
  if (cmd) fullText += cmd + '\n\n';
  if (answer) fullText += answer;
  fullText = fullText.trim();

  return fullText || null;
})()`;

const EXPRESSION_CHECK_BUSY = `(() => {
  const cancelBtn = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"], button[aria-label="Stop"], button.stop-button, svg.lucide-square');
  const busy = !!cancelBtn && cancelBtn.offsetParent !== null;
  return { busy };
})()`;

const EXPRESSION_STOP_GENERATION = `(() => {
  const cancelBtn = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"], button[aria-label="Stop"], button.stop-button, svg.lucide-square')?.closest('button');
  if (cancelBtn && cancelBtn.offsetParent !== null) {
    cancelBtn.click();
    return { ok: true, stopped: true };
  }
  return { ok: false, reason: "stop_button_not_found" };
})()`;

const EXPRESSION_DETECT_ACTIONS = `(() => {
  const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a.monaco-button, div.monaco-button'))
    .filter(b => b.offsetParent !== null);
    
  let autoAcceptBtn = allButtons.find(b => {
    const txt = (b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '');
    return txt.includes('Auto Accept');
  });
  
  let isAutoAcceptOn = false;
  if (autoAcceptBtn) {
    const fullText = (autoAcceptBtn.innerText || '') + ' ' + (autoAcceptBtn.getAttribute('aria-label') || '');
    isAutoAcceptOn = fullText.includes('Auto Accept: ON') || fullText.includes('ON,');
  }

  // 1. Interactive Question Prompt (ask_question modal)
  const questionLabels = Array.from(document.querySelectorAll('label, div[role="radio"], div[role="option"]')).filter(l => l.offsetParent !== null);
  let questionPrompt = null;
  if (questionLabels.length > 0) {
    const options = questionLabels.map((l, idx) => {
      const isChecked = !!l.querySelector('input:checked') || l.getAttribute('aria-checked') === 'true';
      return {
        id: idx,
        text: l.innerText ? l.innerText.trim().replace(/^\d+\s*\n?/, '') : '',
        checked: isChecked
      };
    }).filter(opt => opt.text.length > 0);

    const questionSubmitBtn = allButtons.find(b => (b.innerText || '').includes('Submit'));
    const questionSkipBtn = allButtons.find(b => (b.innerText || '').includes('Skip'));

    if (options.length > 0) {
      questionPrompt = {
        title: 'Interactive Choice Required:',
        options: options,
        canSubmit: !!questionSubmitBtn,
        canSkip: !!questionSkipBtn
      };
    }
  }

  const approvalKeywords = ['allow', 'approve', 'proceed', 'run', 'configure', 'deny', 'review changes', 'accept', 'retry', 'submit', 'skip', 'yes', 'no'];
  const pendingButtons = allButtons.filter(b => {
    const t = (b.innerText || '').trim().toLowerCase();
    return approvalKeywords.some(kw => t === kw || t.startsWith(kw + '\n') || t.startsWith(kw + ' '));
  }).map((b, idx) => ({
    id: idx,
    text: b.innerText.trim().split('\n')[0],
    aria: b.getAttribute('aria-label') || ''
  }));

  let permissionPrompt = null;
  const dialogEl = document.querySelector('div[role="dialog"], div[class*="notification-toast"], div[class*="monaco-dialog"]');
  if (dialogEl && dialogEl.offsetParent !== null) {
    const txt = dialogEl.innerText ? dialogEl.innerText.trim().split('\n')[0] : '';
    if (txt && txt.length < 140) permissionPrompt = txt;
  }
  
  if (!permissionPrompt && questionPrompt) {
    permissionPrompt = questionPrompt.title;
  } else if (!permissionPrompt && pendingButtons.length > 0) {
    permissionPrompt = 'Pending Action: ' + pendingButtons.map(b => b.text).join(' | ');
  }

  return {
    autoAccept: {
      available: !!autoAcceptBtn,
      enabled: isAutoAcceptOn
    },
    permissionPrompt: permissionPrompt,
    pendingButtons: pendingButtons,
    question: questionPrompt
  };
})()`;

const EXPRESSION_GET_MODELS = `(() => {
  const modelBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
    return aria.includes('select model');
  });
  
  let currentModel = 'Gemini 3.7 Flash High';
  if (modelBtn) {
    const aria = modelBtn.getAttribute('aria-label') || '';
    if (aria.includes('current:')) {
      currentModel = aria.split('current:')[1].trim();
    } else if (modelBtn.innerText) {
      currentModel = modelBtn.innerText.trim();
    }
  }

  const models = [
    { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash High', tag: 'Fast', desc: 'Hybrid reasoning & rapid coding' },
    { id: 'gemini-3.6-flash-medium', name: 'Gemini 3.6 Flash Medium', tag: 'Fast', desc: 'Balanced rapid agentic workflows' },
    { id: 'gemini-3.5-flash-medium', name: 'Gemini 3.5 Flash Medium', tag: 'Fast', desc: 'Lightweight high-efficiency model' },
    { id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro Low', tag: 'Deep', desc: 'Deep multi-step reasoning & planning' },
    { id: 'claude-sonnet-4.6-thinking', name: 'Claude Sonnet 4.6 (Thinking)', tag: 'Thinking', desc: 'Anthropic deep chain-of-thought' },
    { id: 'claude-opus-4.6-thinking', name: 'Claude Opus 4.6 (Thinking)', tag: 'Frontier', desc: 'Maximum architecture capability' },
    { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)', tag: 'OSS', desc: 'Open-weights dense transformer' }
  ];

  return {
    current: currentModel,
    models: models
  };
})()`;

const EXPRESSION_SELECT_MODEL_BY_NAME = (modelName) => `(async () => {
  const searchName = ${JSON.stringify(modelName.toLowerCase())};
  const modelBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
    return aria.includes('select model');
  });
  
  if (!modelBtn) return { ok: false, error: 'model_btn_not_found' };

  modelBtn.click();
  await new Promise(r => setTimeout(r, 350));

  const items = Array.from(document.querySelectorAll('div[role="menuitem"], div[role="option"], [role="menuitem"]'));
  const match = items.find(el => {
    const t = (el.innerText || '').toLowerCase().trim();
    if (t.includes(searchName) || searchName.includes(t.split('\n')[0].trim())) return true;
    const cleanT = t.replace(/\s+/g, ' ');
    const cleanSearch = searchName.replace(/\s+/g, ' ');
    if (cleanT.includes(cleanSearch) || cleanSearch.includes(cleanT)) return true;
    if (searchName.includes('3.7') && t.includes('3.7')) return true;
    if (searchName.includes('sonnet') && t.includes('sonnet')) return true;
    if (searchName.includes('opus') && t.includes('opus')) return true;
    if (searchName.includes('3.1') && t.includes('3.1')) return true;
    if (searchName.includes('3.6') && t.includes('3.6')) return true;
    if (searchName.includes('3.5') && t.includes('3.5')) return true;
    if (searchName.includes('gpt') && t.includes('gpt')) return true;
    return false;
  });

  if (match) {
    try {
      match.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      match.click();
      match.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      match.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    } catch(e) {
      match.click();
    }
    await new Promise(r => setTimeout(r, 200));
    return { ok: true, selected: modelName };
  }

  // Close with Escape if not found
  try {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', code: 'Escape' }));
  } catch(e) {}

  return { ok: false, error: 'menu_item_not_found' };
})()`;

const EXPRESSION_CLICK_BUTTON_BY_TEXT = (targetText) => `(() => {
  const search = ${JSON.stringify(targetText.toLowerCase())};
  const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a.monaco-button, div.monaco-button'))
    .filter(b => b.offsetParent !== null);
    
  const match = allButtons.find(b => {
    const t = (b.innerText || '').trim().toLowerCase();
    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
    return t === search || t.startsWith(search + '\\n') || t.startsWith(search + ' ') || aria.includes(search);
  });
  
  if (match) {
    match.click();
    return { ok: true, text: match.innerText.trim() };
  }
  return { ok: false, error: 'button_not_found' };
})()`;

const EXPRESSION_TOGGLE_AUTO_ACCEPT = `(() => {
  const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a.monaco-button'))
    .filter(b => b.offsetParent !== null);
    
  const autoAcceptBtn = allButtons.find(b => {
    const txt = (b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '');
    return txt.includes('Auto Accept');
  });
  
  if (autoAcceptBtn) {
    autoAcceptBtn.click();
    return { ok: true, clicked: true };
  }
  return { ok: false, error: 'auto_accept_button_not_found' };
})()`;

const EXPRESSION_SCRAPE_ALL_MESSAGES = `(() => {
  const articles = Array.from(document.querySelectorAll('div[role="article"]'));
  return articles.map((a, index) => {
    const isUser = a.querySelector('.bg-accent, .bg-primary, [data-author="user"]') !== null ||
                   a.classList.contains('user-article') ||
                   (a.getAttribute('aria-label') || '').toLowerCase().includes('user') ||
                   (a.className && typeof a.className === 'string' && a.className.includes('items-end'));

    if (isUser) {
      const text = a.innerText.trim();
      return { from: 'user', text, index };
    }

    let thought = '';
    const thoughtBtn = a.querySelector('button[class*="tabular-nums"]');
    if (thoughtBtn && thoughtBtn.innerText) {
      const tText = thoughtBtn.innerText.trim();
      if (/^(?:Thought for|Worked for|Thinking)/i.test(tText)) {
        thought = tText;
      }
    }

    let cmd = '';
    const toolStepNodes = Array.from(a.querySelectorAll('div.w-full.my-0.5, button[class*="tabular-nums"], div[class*="run-command"], div[class*="group/run-command"], div[class*="terminal"], div[class*="tool-invocation"]'));
    const toolSteps = toolStepNodes
      .map(tn => tn.innerText.trim())
      .filter(t => t && !/^(?:Thought for|Worked for|Thinking)/i.test(t));

    if (toolSteps.length > 0) {
      const deduped = toolSteps.filter((s, i, arr) => i === 0 || s !== arr[i-1]);
      cmd = String.fromCharCode(96,96,96) + "bash\n" + deduped.join("\n") + "\n" + String.fromCharCode(96,96,96);
    }

    let answer = '';
    const textNodes = Array.from(a.querySelectorAll('div.leading-relaxed.select-text, div.rendered-markdown, div.prose'))
      .filter(el => !el.closest('button[class*="tabular-nums"], div.w-full.my-0.5, div[class*="run-command"], div[class*="terminal"]'));

    if (textNodes.length > 0) {
      answer = textNodes.map(t => t.innerText.trim()).filter(Boolean).join('\n\n');
    }

    let fullText = '';
    if (thought) fullText += thought + '\n\n';
    if (cmd) fullText += cmd + '\n\n';
    if (answer) fullText += answer;
    fullText = fullText.trim();

    return {
      from: 'agent',
      text: fullText || '(Thinking...)',
      index
    };
  }).filter(m => m.text && m.text !== '(Thinking...)');
})()`;

const EXPRESSION_INJECT_MESSAGE = (message) => `(async () => {
  const text = ${JSON.stringify(message)};
  
  const quickInput = document.querySelector('input.w-full.py-2, input[placeholder*="Ask"], input[placeholder*="Prompt"]');
  if (quickInput && quickInput.offsetParent !== null) {
    quickInput.focus();
    quickInput.value = text;
    quickInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    quickInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
    quickInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
    return { ok: true, method: 'launchpad_input' };
  }
  
  const editors = [...document.querySelectorAll('[data-lexical-editor="true"][contenteditable="true"][role="textbox"], div.input-prompt-editor, [contenteditable="true"], textarea')]
    .filter(el => el.offsetParent !== null);
  const editor = editors.at(-1);
  
  if (!editor) return { ok: false, error: "editor_not_found" };

  const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"], button[aria-label="Stop"], svg.lucide-square');
  if (cancel && cancel.offsetParent !== null) {
    return { ok: false, reason: "busy_cancel_visible" };
  }

  editor.focus();
  try {
    document.execCommand?.("selectAll", false, null);
    document.execCommand?.("delete", false, null);
  } catch (e) {}

  let inserted = false;
  try {
    inserted = !!document.execCommand?.("insertText", false, text);
  } catch (e) {}
  
  if (!inserted) {
    if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
      editor.value = text;
    } else {
      editor.textContent = text;
    }
    editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: text }));
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  await new Promise(r => setTimeout(r, 120));

  const submit = document.querySelector('[data-tooltip-id="input-send-button-tooltip"]')
    || document.querySelector("svg.lucide-arrow-right")?.closest("button")
    || document.querySelector('button[type="submit"]')
    || document.querySelector('button.send-button');
    
  if (submit && !submit.disabled) {
    setTimeout(() => submit.click(), 50);
    return { ok: true, method: "click_submit" };
  }

  editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
  editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter" }));
  return { ok: true, method: "enter_fallback" };
})()`;

const EXPRESSION_SETUP_OBSERVER = `(() => {
  if (window._agObserverActive && window._agObserverTarget && document.body.contains(window._agObserverTarget)) {
    return { ok: true, status: "already_active" };
  }

  const container = document.body;
  window._agObserverTarget = container;
  window._agObserverActive = true;
  window._agLastSeenCount = 0;
  window._agLastEmittedText = "";

  if (window._agMutationObserver) {
    window._agMutationObserver.disconnect();
  }

  let debounceTimer = null;

  window._agMutationObserver = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const articles = document.querySelectorAll('div[role="article"]');
        if (!articles.length) return;
        
        const a = articles[articles.length - 1];
        const label = (a.getAttribute('aria-label') || '').toLowerCase();
        const isAgent = label.includes('Agent') || label.includes('response') || !label.includes('user');

        let thought = '';
        const thoughtBtn = a.querySelector('button[class*="tabular-nums"]');
        if (thoughtBtn && thoughtBtn.innerText) {
          thought = thoughtBtn.innerText.trim();
        }

        let cmd = '';
        const toolNodes = Array.from(a.querySelectorAll('div[class*="run-command"], div[class*="group/run-command"], div[class*="terminal"], div[class*="tool-invocation"]'));
        if (toolNodes.length > 0) {
          const toolText = toolNodes.map(tn => tn.innerText.trim()).filter(Boolean).join('\n');
          if (toolText) {
            cmd = String.fromCharCode(96,96,96) + "bash\n" + toolText + "\n" + String.fromCharCode(96,96,96);
          }
        }

        let answer = '';
        const textNodes = Array.from(a.querySelectorAll('.rendered-markdown, .prose, .leading-relaxed.select-text'))
          .filter(el => !el.closest('div[class*="run-command"], div[class*="group/run-command"], div[class*="terminal"], div[class*="tool-invocation"]'));

        if (textNodes.length > 0) {
          answer = textNodes.map(t => t.innerText.trim()).filter(Boolean).join('\n\n');
        } else if (!cmd && a.innerText) {
          let rawA = a.innerText.trim();
          const cmdRegex = new RegExp("^(?:Ran|Run|Running|python3|bash|sh|cat|grep|curl|echo|~/|/home/|\\$|>>>)", "i");
      if (cmdRegex.test(rawA)) {
            cmd = String.fromCharCode(96,96,96) + "bash\n" + rawA.replace(/^(?:Ran|Run|Running)\s*\n?/i, '') + "\n" + String.fromCharCode(96,96,96);
          } else {
            answer = rawA;
          }
        }

        if (thought && answer.startsWith(thought)) {
          answer = answer.slice(thought.length).trim();
        }

        let parts = [];
        if (thought) parts.push(thought);
        if (cmd) parts.push(cmd);
        if (answer) parts.push(answer);

        const text = parts.join('\n\n').trim();
        
        if (text && text !== window._agLastEmittedText && text.length > 2) {
          window._agLastEmittedText = text;
          console.log('__AG_MSG__:' + JSON.stringify({
            from: isAgent ? 'agent' : 'user',
            text: text,
            timestamp: new Date().toISOString()
          }));
        }
      } catch (err) {}
    }, 120);
  });

  window._agMutationObserver.observe(container, {
    childList: true,
    subtree: true,
    characterData: true
  });

  return { ok: true, status: "observer_attached" };
})()`;

const EXPRESSION_GET_TABS = `(() => {
  const tabElements = Array.from(document.querySelectorAll('.tab, div[role="tab"]'));
  return {
    ok: true,
    tabs: tabElements.map((t, idx) => ({
      index: idx,
      title: t.getAttribute('aria-label') || t.innerText.trim().split('\\n')[0],
      active: t.classList.contains('active') || t.getAttribute('aria-selected') === 'true'
    }))
  };
})()`;

const EXPRESSION_FOCUS_TAB = (index) => `(() => {
  const tabElements = Array.from(document.querySelectorAll('.tab, div[role="tab"]'));
  const target = tabElements[${index}];
  if (target) {
    target.click();
    return { ok: true };
  }
  return { ok: false, error: "tab_not_found" };
})()`;

// ----------------------------------------------------------------------
// CDP Bridge Implementation with Concurrency Mutex
// ----------------------------------------------------------------------

class CdpBridge {
  constructor() {
    this.ws = null;
    this.msgId = 1;
    this.pendingCallbacks = new Map();
    this.contexts = new Set();
    this.activeContextId = null;
    this.connected = false;
    this.onNewMessage = null;
    this.onAgentState = null;
    this.onActionDetected = null;
    this.reconnectTimer = null;
    this.healthTimer = null;
    this.currentTarget = ACTIVE_TARGET;
    
    // Concurrency execution queue to prevent parallel CDP collision & timeouts
    this.queue = [];
    this.isProcessingQueue = false;
    this.isHealthCheckInProgress = false;
  }

  async switchTarget(targetName) {
    if (targetName !== 'host' && targetName !== 'vm') return false;
    this.currentTarget = targetName;
    CDP_PORT = targetName === 'vm' ? 9222 : 9223;
    log(`Target switched to ${targetName.toUpperCase()} (Port ${CDP_PORT})`);
    
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.connected = false;
    return await this.connect();
  }

  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return true;

    try {
      // 1. Try specified port
      let targets = await this.fetchTargets(CDP_PORT);
      
      // Strictly lock to port 9222 (VM Local Antigravity IDE)
      CDP_PORT = 9222;
      this.currentTarget = 'vm';
    this.activeModelName = 'Gemini 3.7 Flash Medium';

      if (!targets || !targets.length) {
        this.scheduleReconnect();
        return false;
      }

      // Filter out non-page/worker targets, self/remote web pages, and helpers
      const validTargets = targets.filter(t => {
        if (t.type && t.type !== 'page' && t.type !== 'webview') return false;
        const url = (t.url || '').toLowerCase();
        const title = (t.title || '').toLowerCase();
        if (url.includes(':8787') || url.includes(':3000')) return false;
        if (title.includes('gravityrem') || title.includes('phone chat')) return false;
        return true;
      });

      const pool = validTargets.length ? validTargets : targets.filter(t => t.type === 'page');
      let target = pool.find(t => t.url && (t.url.includes('workbench.html') || t.url.includes('vscode-file')) && !t.url.includes('jetski'));
      if (!target) target = pool.find(t => (t.title && t.title.includes('Antigravity')) || (t.url && t.url.includes('vscode')));
      if (!target) target = pool.find(t => t.type === 'page');
      if (!target) target = pool[0];

      if (!target || !target.webSocketDebuggerUrl) {
        this.scheduleReconnect();
        return false;
      }

      log(`Connecting to CDP target on port ${CDP_PORT}: ${target.title || target.url} (${target.id})`);
      this.ws = new WebSocket(target.webSocketDebuggerUrl);

      this.ws.on('open', async () => {
        this.connected = true;
        log(`✅ Connected to Antigravity IDE [${this.currentTarget.toUpperCase()}] via CDP (Port ${CDP_PORT})!`);
        setTimeout(() => this.syncAllMessages(), 400);
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        await this.enableDomains();
        await this.discoverContexts();
        this.startObserver();
        this.startHealthChecks();
        
        setTimeout(() => this.syncAllMessages(), 1000);
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', () => {
        this.connected = false;
        log('CDP WebSocket disconnected.');
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        this.connected = false;
      });

      return true;
    } catch (err) {
      this.scheduleReconnect();
      return false;
    }
  }

  fetchTargets(port = CDP_PORT) {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/json`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve([]);
          }
        });
      });
      req.on('error', () => resolve([]));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve([]);
      });
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 4000);
  }

  // Serialized execution queue for CDP commands
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ method, params, resolve, reject, isEval: false });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessingQueue || this.queue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        item.reject(new Error('CDP not connected'));
        continue;
      }

      const id = this.msgId++;
      const timeoutMs = item.timeout || 8000;

      try {
        const result = await new Promise((res, rej) => {
          const timeoutHandle = setTimeout(() => {
            if (this.pendingCallbacks.has(id)) {
              this.pendingCallbacks.delete(id);
              rej(new Error(`CDP command timeout: ${item.method}`));
            }
          }, timeoutMs);

          this.pendingCallbacks.set(id, {
            resolve: (val) => {
              clearTimeout(timeoutHandle);
              res(val);
            },
            reject: (err) => {
              clearTimeout(timeoutHandle);
              rej(err);
            },
            method: item.method
          });

          this.ws.send(JSON.stringify({ id, method: item.method, params: item.params }));
        });

        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }

    this.isProcessingQueue = false;
  }

  async enableDomains() {
    try {
      await this.send('Runtime.enable');
      await this.send('DOM.enable');
      await this.send('Page.enable');
      await this.send('Console.enable');
    } catch (e) {}
  }

  async discoverContexts() {
    try {
      await this.send('DOM.getDocument', { depth: -1, pierce: true });
    } catch (e) {}
  }

  handleMessage(raw) {
    try {
      const msg = JSON.parse(raw);

      if (msg.id && this.pendingCallbacks.has(msg.id)) {
        const { resolve, reject } = this.pendingCallbacks.get(msg.id);
        this.pendingCallbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'CDP Error'));
        else resolve(msg.result);
        return;
      }

      if (msg.method === 'Runtime.executionContextCreated') {
        const ctxId = msg.params.context.id;
        this.contexts.add(ctxId);
        this.activeContextId = ctxId;
        this.startObserver(ctxId);
      } else if (msg.method === 'Runtime.executionContextDestroyed') {
        this.contexts.delete(msg.params.executionContextId);
      }

      if (msg.method === 'Runtime.consoleAPICalled') {
        const args = msg.params.args || [];
        for (const a of args) {
          if (a.value && typeof a.value === 'string' && a.value.startsWith('__AG_MSG__:')) {
            try {
              const payload = JSON.parse(a.value.substring('__AG_MSG__:'.length));
              if (this.onNewMessage) this.onNewMessage(payload);
            } catch (e) {}
          }
        }
      }
    } catch (err) {}
  }

  async evaluate(expression, contextId = null) {
    const params = {
      expression,
      returnByValue: true,
      awaitPromise: true
    };
    if (contextId) params.contextId = contextId;

    try {
      const res = await this.send('Runtime.evaluate', params);
      return res && res.result ? res.result.value : null;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async startObserver(contextId = null) {
    try {
      await this.evaluate(EXPRESSION_SETUP_OBSERVER, contextId);
    } catch (e) {}
  }

  async syncAllMessages() {
    try {
      const res = await this.evaluate(EXPRESSION_SCRAPE_ALL_MESSAGES);
      if (res && res.ok && Array.isArray(res.messages) && res.messages.length > 0) {
        if (this.onAllMessages) {
          this.onAllMessages(res.messages);
        }
        return res.messages;
      }
    } catch (e) {}
    return [];
  }

  startHealthChecks() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.lastBusyState = false;

    this.healthTimer = setInterval(async () => {
      if (!this.connected || this.isHealthCheckInProgress) return;
      this.isHealthCheckInProgress = true;

      try {
        const busyRes = await this.evaluate(EXPRESSION_CHECK_BUSY);
        const curModelRes = await this.evaluate(`(() => {
          const modelBtn = document.querySelector('button[aria-label*="Select model"]');
          if (modelBtn) {
            const aria = modelBtn.getAttribute('aria-label') || '';
            if (aria.includes('current:')) return aria.split('current:')[1].trim();
            if (modelBtn.innerText) return modelBtn.innerText.trim();
          }
          return '';
        })()`);
        if (curModelRes && typeof curModelRes === 'string' && curModelRes.length > 0) {
          this.activeModelName = curModelRes;
        }
        const isBusy = !!(busyRes && busyRes.busy);
        
        if (this.onAgentState) {
          this.onAgentState({ busy: isBusy });
        }

        // Auto-sync full transcript whenever agent transitions from busy -> idle
        if (this.lastBusyState && !isBusy) {
          await this.syncAllMessages();
        }
        this.lastBusyState = isBusy;

        // Auto-dispatch queued prompts in IDE if agent is not busy
        if (!isBusy) {
          await this.evaluate(`(() => {
            const sendNowButtons = Array.from(document.querySelectorAll('button[aria-label="Send Now"], button:not([disabled])')).filter(b => {
              const aria = b.getAttribute('aria-label') || '';
              const text = b.innerText || '';
              return aria === 'Send Now' || text.trim() === 'Send Now';
            });
            if (sendNowButtons.length > 0) {
              const btn = sendNowButtons[0];
              try {
                btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                btn.click();
                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
              } catch(e) {
                btn.click();
              }
              return { ok: true, dispatched: true };
            }
            return { ok: false };
          })()`);
        }

        const actionsRes = await this.evaluate(EXPRESSION_DETECT_ACTIONS);
        if (actionsRes && this.onActionDetected) {
          this.onActionDetected(actionsRes);
        }

        // Live stream sync for active/last message
        const lastMsg = await this.evaluate(EXPRESSION_CHECK_LAST_MESSAGE);
        if (lastMsg && lastMsg.text && this.onNewMessage) {
          this.onNewMessage(lastMsg);
        }
      } catch (e) {
      } finally {
        this.isHealthCheckInProgress = false;
      }
    }, 1200);
  }

  async clickButtonByText(text) {
    return await this.evaluate(EXPRESSION_CLICK_BUTTON_BY_TEXT(text));
  }

  async toggleAutoAccept() {
    return await this.evaluate(EXPRESSION_TOGGLE_AUTO_ACCEPT);
  }

  async injectMessage(message) {
    if (!this.connected) {
      const ok = await this.connect();
      if (!ok) return { ok: false, error: 'cdp_not_connected' };
    }

    const text = String(message || '').trim();
    if (!text) return { ok: false, error: 'empty_text' };

    try {
      // 1. Focus editor and select node contents
      const focusRes = await this.evaluate(`(() => {
        let editor = document.querySelector('div[contenteditable="true"][role="combobox"]') ||
                     document.querySelector('div[contenteditable="true"][aria-label="Message input"]') ||
                     document.querySelector('[data-lexical-editor="true"][contenteditable="true"]') ||
                     document.querySelector('div[contenteditable="true"][role="textbox"]') ||
                     document.querySelector('div[contenteditable="true"]');
        if (!editor) {
          const cascadePanel = document.querySelector('#conversation, #chat, #cascade');
          if (cascadePanel) {
            const editables = [...cascadePanel.querySelectorAll('[contenteditable="true"]')].filter(el => el.offsetParent !== null);
            editor = editables.at(-1);
          }
        }
        if (!editor) return { ok: false, error: 'editor_not_found' };
        editor.focus();
        try {
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            const range = document.createRange();
            range.selectNodeContents(editor);
            sel.addRange(range);
          }
        } catch (e) {}
        return { ok: true };
      })()`);

      if (!focusRes || focusRes.ok === false) {
        return { ok: false, error: focusRes ? focusRes.error : 'focus_failed' };
      }

      await new Promise(r => setTimeout(r, 60));

      // 2. Clear existing content with Ctrl+A -> Backspace
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'a', code: 'KeyA',
        modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65
      });
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'a', code: 'KeyA',
        modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65
      });
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Backspace', code: 'Backspace',
        windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8
      });
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Backspace', code: 'Backspace',
        windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8
      });

      await new Promise(r => setTimeout(r, 60));

      // 3. Insert text via CDP native typing
      await this.send('Input.insertText', { text });
      await new Promise(r => setTimeout(r, 150));

            // 4. Submit cleanly via Enter key + Button Click fallback
      await this.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown', key: 'Enter', code: 'Enter',
        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
      });
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter',
        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
      });

      await new Promise(r => setTimeout(r, 80));

      await this.evaluate(`(() => {
        const submit = document.querySelector('[data-tooltip-id="input-send-button-send-tooltip"]') ||
                       document.querySelector('[data-tooltip-id="input-send-button-pending-tooltip"]') ||
                       document.querySelector('button[aria-label^="Send" i]') ||
                       document.querySelector('button svg.lucide-arrow-right')?.closest('button') ||
                       document.querySelector('button svg.lucide-corner-down-left')?.closest('button');
        if (submit && !submit.disabled) {
          submit.click();
          try { submit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); } catch(e) {}
        }
      })()`);

      return { ok: true, method: 'native_cdp_injection', length: text.length };
    } catch (e) {
      return { ok: false, error: 'injection_exception: ' + e.message };
    }
  }

  async stopGeneration() {
    return await this.evaluate(EXPRESSION_STOP_GENERATION);
  }

  async getModels() {
    return await this.evaluate(EXPRESSION_GET_MODELS);
  }

  async selectModel(name) {
    return await this.evaluate(EXPRESSION_SELECT_MODEL_BY_NAME(name));
  }

  async setModel(index = 0) {
    try {
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        modifiers: 10,
        windowsVirtualKeyCode: 77,
        key: 'M',
        code: 'KeyM'
      });
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        modifiers: 10,
        windowsVirtualKeyCode: 77,
        key: 'M',
        code: 'KeyM'
      });

      await new Promise(r => setTimeout(r, 300));

      for (let i = 0; i < index; i++) {
        await this.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          windowsVirtualKeyCode: 40,
          key: 'ArrowDown',
          code: 'ArrowDown'
        });
        await this.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          windowsVirtualKeyCode: 40,
          key: 'ArrowDown',
          code: 'ArrowDown'
        });
        await new Promise(r => setTimeout(r, 50));
      }

      await this.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        windowsVirtualKeyCode: 13,
        key: 'Enter',
        code: 'Enter'
      });
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        windowsVirtualKeyCode: 13,
        key: 'Enter',
        code: 'Enter'
      });

      return { ok: true, modelIndex: index };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async startNewChat() {
    const CLICK_EXP = `(async () => {
      try {
        const newBtn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]') ||
                       document.querySelector('a[data-tooltip-id*="new-conversation"]') ||
                       document.querySelector('[data-past-conversations-toggle="true"]')?.parentElement?.querySelector('[data-tooltip-id*="new"]') ||
                       Array.from(document.querySelectorAll('a, button, [role="button"]')).find(el => {
                         const aria = el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '';
                         return /new conversation|new chat|start new/i.test(aria);
                       });

        if (newBtn) {
          try {
            newBtn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
            newBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
            newBtn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, view: window }));
            newBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
            newBtn.click();
          } catch(e) {
            newBtn.click();
          }
          return { ok: true, method: 'dom_new_conversation_tooltip' };
        }
        return { ok: false, error: 'new_chat_btn_not_found' };
      } catch(e) {
        return { ok: false, error: e.toString() };
      }
    })()`;

    try {
      let res = await this.evaluate(CLICK_EXP);
      if (!res?.ok) {
        for (const ctx of this.contexts) {
          try {
            const r = await this.send('Runtime.evaluate', {
              expression: CLICK_EXP,
              returnByValue: true,
              awaitPromise: true,
              contextId: ctx.id
            });
            if (r.result?.value?.ok) {
              res = r.result.value;
              break;
            }
          } catch(e) {}
        }
      }

      // Activate Agent mode with Ctrl+E
      await new Promise(r => setTimeout(r, 600));
      try {
        await this.send('Input.dispatchKeyEvent', {
          type: 'keyDown', key: 'e', code: 'KeyE',
          modifiers: 2, windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69
        });
        await this.send('Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'e', code: 'KeyE',
          modifiers: 2, windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69
        });
      } catch(e) {}

      setTimeout(() => {
        this.discoverContexts();
        this.startObserver();
      }, 800);

      return { ok: true, detail: res };
    } catch(e) {
      return { ok: false, error: e.message };
    }
  }

  async getOpenTabs() {
    return await this.evaluate(EXPRESSION_GET_TABS);
  }

  async focusTab(index) {
    return await this.evaluate(EXPRESSION_FOCUS_TAB(index));
  }

  async captureScreenshot(quality = 65) {
    try {
      const res = await this.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: quality
      });
      return res ? res.data : null;
    } catch (e) {
      return null;
    }
  }

  async getChatHistory() {
    const SCRAPE_EXP = `(async () => {
      try {
        let items = Array.from(document.querySelectorAll('div[id^="fastpick-item-"]'));
        let opened = false;
        if (items.length === 0) {
          const btn = document.querySelector('a[data-tooltip-id="history-tooltip"]') ||
                      document.querySelector('[data-past-conversations-toggle="true"]') ||
                      document.querySelector('[data-tooltip-id*="past-conversations"]') ||
                      document.querySelector('button[title*="Past Conversations"], a[title*="Past Conversations"]');
          if (btn) {
            btn.click();
            opened = true;
            await new Promise(r => setTimeout(r, 600));
            items = Array.from(document.querySelectorAll('div[id^="fastpick-item-"]'));
          }
        }

        const showMore = document.querySelector('[id^="fastpick-show-more"]');
        if (showMore) {
          try {
            showMore.click();
            await new Promise(r => setTimeout(r, 300));
            items = Array.from(document.querySelectorAll('div[id^="fastpick-item-"]'));
          } catch(e) {}
        }

        const chats = items.map(el => {
          const id = el.id.replace("fastpick-item-", "");
          const isSelected = el.getAttribute("aria-selected") === "true";
          const lines = (el.innerText || "").split("\n").map(l => l.trim()).filter(Boolean);
          const title = lines[0] || "Untitled Conversation";
          let date = "Recent";
          let workspace = "";
          if (lines.length >= 3) {
            workspace = lines[1];
            date = lines[2];
          } else if (lines.length === 2) {
            date = lines[1];
          }
          return { id, title, workspace, date, isSelected };
        }).filter(c => c.id && c.title !== "Start New Conversation");

        if (opened) {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27 }));
        }

        return { ok: true, count: chats.length, chats };
      } catch(e) {
        return { ok: false, error: e.toString(), chats: [] };
      }
    })()`;

    try {
      let res = await this.evaluate(SCRAPE_EXP);
      if (!res?.ok || !res?.chats?.length) {
        for (const ctx of this.contexts) {
          try {
            const r = await this.send('Runtime.evaluate', {
              expression: SCRAPE_EXP,
              returnByValue: true,
              awaitPromise: true,
              contextId: ctx.id
            });
            if (r.result?.value?.ok && r.result?.value?.chats?.length) {
              res = r.result.value;
              break;
            }
          } catch(e) {}
        }
      }
      return res;
    } catch(e) {
      return { ok: false, error: e.message, chats: [] };
    }
  }

  async selectChat(chatId, title = '') {
    const safeId = JSON.stringify(chatId || '');
    const safeTitle = JSON.stringify(title || '');

    const SELECT_EXP = `(async () => {
      try {
        const targetId = ${safeId};
        const targetTitle = ${safeTitle};

        let items = Array.from(document.querySelectorAll('div[id^="fastpick-item-"]'));
        if (items.length === 0) {
          const historyBtn = document.querySelector('a[data-tooltip-id="history-tooltip"]') ||
                             document.querySelector('[data-past-conversations-toggle="true"]') ||
                             document.querySelector('[data-tooltip-id*="past-conversations"]') ||
                             document.querySelector('button[title*="Past Conversations"], a[title*="Past Conversations"]');
          if (historyBtn) {
            historyBtn.click();
            await new Promise(r => setTimeout(r, 600));
            items = Array.from(document.querySelectorAll('div[id^="fastpick-item-"]'));
          }
        }

        let el = null;
        if (targetId) {
          el = document.getElementById("fastpick-item-" + targetId);
        }
        if (!el && targetTitle) {
          const clean = targetTitle.toLowerCase().trim();
          el = items.find(item => (item.innerText || "").toLowerCase().includes(clean));
        }

        if (!el) {
          const showMore = document.querySelector('[id^="fastpick-show-more"]');
          if (showMore) {
            showMore.click();
            await new Promise(r => setTimeout(r, 350));
            items = Array.from(document.querySelectorAll('div[id^="fastpick-item-"]'));
            if (targetId) el = document.getElementById("fastpick-item-" + targetId);
            if (!el && targetTitle) {
              const clean = targetTitle.toLowerCase().trim();
              el = items.find(item => (item.innerText || "").toLowerCase().includes(clean));
            }
          }
        }

        if (!el) return { ok: false, error: "Conversation not found in history list" };

        el.click();
        try {
          el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, view: window }));
        } catch (e) {}

        return { ok: true, id: targetId, title: targetTitle };
      } catch(e) {
        return { ok: false, error: e.toString() };
      }
    })()`;

    try {
      let res = await this.evaluate(SELECT_EXP);
      if (!res?.ok) {
        for (const ctx of this.contexts) {
          try {
            const r = await this.send('Runtime.evaluate', {
              expression: SELECT_EXP,
              returnByValue: true,
              awaitPromise: true,
              contextId: ctx.id
            });
            if (r.result?.value?.ok) {
              res = r.result.value;
              break;
            }
          } catch(e) {}
        }
      }

      // Re-arm observer and sync
      setTimeout(() => {
        this.discoverContexts();
        this.startObserver();
      }, 500);

      return res;
    } catch(e) {
      return { ok: false, error: e.message };
    }
  }

  async selectQuestionOption(index) {
    return await this.evaluate(`(() => {
      const labels = Array.from(document.querySelectorAll('label, div[role="radio"], div[role="option"]')).filter(l => l.offsetParent !== null);
      const target = labels[${index}];
      if (target) {
        target.click();
        try {
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          const input = target.querySelector('input');
          if (input) {
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } catch(e) {}
        return { ok: true };
      }
      return { ok: false, error: 'option_not_found' };
    })()`);
  }

  async submitQuestion(isSkip = false) {
    return await this.evaluate(`(() => {
      const allButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => b.offsetParent !== null);
      const targetBtn = allButtons.find(b => {
        const txt = (b.innerText || '').toLowerCase();
        return isSkip ? txt.includes('skip') : txt.includes('submit');
      });
      if (targetBtn) {
        targetBtn.click();
        try { targetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } catch(e) {}
        return { ok: true };
      }
      return { ok: false, error: 'button_not_found' };
    })()`);
  }
}

export const cdpBridge = new CdpBridge();
