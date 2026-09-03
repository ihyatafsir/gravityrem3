/**
 * GRAVITYR3 — Minimalist Professional Client Application Logic (v3.3)
 */

const state = {
  ws: null,
  connected: false,
  messages: [],
  agent: { state: 'idle', busy: false },
  actions: { autoAccept: { available: false, enabled: false }, permissionPrompt: null, pendingButtons: [] },
  stats: null,
  activeModel: 'Gemini 3.7 Flash High',
  modelsList: [],
  activeTarget: 'host',
  isRecording: false,
  speechRecognition: null,
  autoScroll: true,
  userScrolledUp: false,
  drawerActiveTab: 'plan',
  agFeatures: null,
  messageQueue: [],
  lensAutoRefreshInterval: 0,
  lensTimer: null,
  terminalHistory: [],
  terminalHistoryIndex: -1,
  currentTheme: (new URLSearchParams(window.location.search).get('theme')) || localStorage.getItem('ag_theme') || 'matrix',
  searchQuery: '',
  visibleLimit: 80
};

function formatShortModelName(name) {
  if (!name) return "Gemini 3.7 (High)";
  let short = "Gemini 3.7";
  if (name.includes("3.8")) short = "Gemini 3.8";
  else if (name.includes("3.7")) short = "Gemini 3.7";
  else if (name.includes("3.6")) short = "Gemini 3.6";
  else if (name.includes("3.5")) short = "Gemini 3.5";
  else if (name.includes("3.1")) short = "3.1 Pro";
  else if (name.includes("Sonnet")) short = "Sonnet 4.6";
  else if (name.includes("Opus")) short = "Opus 4.6";
  else if (name.includes("GPT")) short = "GPT-OSS";
  else short = name.split(" ")[0];

  let tier = "";
  if (/high/i.test(name)) tier = "High";
  else if (/medium/i.test(name)) tier = "Med";
  else if (/low/i.test(name)) tier = "Low";
  else if (/thinking/i.test(name)) tier = "Think";

  return tier ? `${short} (${tier})` : short;
}

const MODEL_FAMILIES = [
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    tag: "Next-Gen",
    desc: "Next-generation ultra-fast hybrid reasoning & coding",
    tiers: [
      { id: "gemini-3.8-flash-high", name: "High", fullName: "Gemini 3.8 Flash High", desc: "Maximum hybrid reasoning (1.00)" },
      { id: "gemini-3.8-flash-medium", name: "Medium", fullName: "Gemini 3.8 Flash Medium", desc: "Balanced reasoning & speed (0.50)" },
      { id: "gemini-3.8-flash-low", name: "Low", fullName: "Gemini 3.8 Flash Low", desc: "Low thinking latency (0.10)" }
    ]
  },
  {
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    tag: "Flagship",
    desc: "Google flagship hybrid reasoning & rapid coding",
    tiers: [
      { id: "gemini-3.7-flash-high", name: "High", fullName: "Gemini 3.7 Flash High", desc: "Maximum hybrid reasoning (1.00)" },
      { id: "gemini-3.7-flash-medium", name: "Medium", fullName: "Gemini 3.7 Flash Medium", desc: "Balanced reasoning & speed (0.50)" },
      { id: "gemini-3.7-flash-low", name: "Low", fullName: "Gemini 3.7 Flash Low", desc: "Low thinking latency (0.10)" }
    ]
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    tag: "Fast",
    desc: "Balanced rapid agentic workflows & tool execution",
    tiers: [
      { id: "gemini-3.6-flash-high", name: "High", fullName: "Gemini 3.6 Flash High", desc: "High reasoning tier" },
      { id: "gemini-3.6-flash-medium", name: "Medium", fullName: "Gemini 3.6 Flash Medium", desc: "Standard medium tier" },
      { id: "gemini-3.6-flash-low", name: "Low", fullName: "Gemini 3.6 Flash Low", desc: "Fast low latency tier" }
    ]
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    tag: "Light",
    desc: "Lightweight high-efficiency model",
    tiers: [
      { id: "gemini-3.5-flash-high", name: "High", fullName: "Gemini 3.5 Flash High", desc: "High reasoning tier" },
      { id: "gemini-3.5-flash-medium", name: "Medium", fullName: "Gemini 3.5 Flash Medium", desc: "Balanced medium tier" },
      { id: "gemini-3.5-flash-low", name: "Low", fullName: "Gemini 3.5 Flash Low", desc: "Low latency tier" }
    ]
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    tag: "Deep",
    desc: "Deep multi-step reasoning & planning",
    tiers: [
      { id: "gemini-3.1-pro-high", name: "High", fullName: "Gemini 3.1 Pro High", desc: "Deep multi-pass reasoning" },
      { id: "gemini-3.1-pro-medium", name: "Medium", fullName: "Gemini 3.1 Pro Medium", desc: "Standard deep tier" },
      { id: "gemini-3.1-pro-low", name: "Low", fullName: "Gemini 3.1 Pro Low", desc: "Deep reasoning low latency" }
    ]
  },
  {
    id: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    tag: "Thinking",
    desc: "Anthropic deep chain-of-thought architecture",
    tiers: [
      { id: "claude-sonnet-4.6-thinking", name: "Thinking", fullName: "Claude Sonnet 4.6 (Thinking)", desc: "Deep thought synthesis" }
    ]
  },
  {
    id: "claude-opus-4.6",
    name: "Claude Opus 4.6",
    tag: "Frontier",
    desc: "Maximum frontier reasoning & complex systems",
    tiers: [
      { id: "claude-opus-4.6-thinking", name: "Thinking", fullName: "Claude Opus 4.6 (Thinking)", desc: "Max cognitive ceiling" }
    ]
  },
  {
    id: "gpt-oss-120b",
    name: "GPT-OSS 120B",
    tag: "OSS",
    desc: "Open-weights dense transformer model",
    tiers: [
      { id: "gpt-oss-120b-medium", name: "Medium", fullName: "GPT-OSS 120B (Medium)", desc: "Standard dense execution" }
    ]
  }
];

const elements = {
  brandBadge: document.getElementById('brand-badge'),
  targetSwitchBtn: document.getElementById('target-switch-btn'),
  targetLabel: document.getElementById('target-label'),
  autoAcceptBtn: document.getElementById('auto-accept-btn'),
  chatViewport: document.getElementById('chat-viewport'),
  promptInput: document.getElementById('prompt-input'),
  sendBtn: document.getElementById('send-btn'),
  micBtn: document.getElementById('mic-btn'),
  attachBtn: document.getElementById('attach-btn'),
  fileInput: document.getElementById('file-upload-input'),
  stopBtn: document.getElementById('stop-btn'),
  newChatBtn: document.getElementById('new-chat-btn'),
  syncBtn: document.getElementById('sync-btn'),
  modeSwitchBtn: document.getElementById('mode-switch-btn'),
  modeLabel: document.getElementById('current-mode-label'),
  modeIcon: document.getElementById('current-mode-icon'),
  modelBtn: document.getElementById('model-btn'),
  modelLabel: document.getElementById('current-model-label'),
  historyBtn: document.getElementById('history-btn'),
  statusDot: document.getElementById('status-dot'),
  cpuStat: document.getElementById('cpu-stat'),
  ramStat: document.getElementById('ram-stat'),
  cdpStatusStat: document.getElementById('cdp-status-stat'),
  modelModal: document.getElementById('model-modal'),
  historyModal: document.getElementById('history-modal'),
  lensModal: document.getElementById('lens-modal'),
  lensModalImg: document.getElementById('lens-modal-img'),
  drawerOverlay: document.getElementById('ag-drawer-overlay'),
  drawerBody: document.getElementById('drawer-body'),
  historyList: document.getElementById('history-list'),
  modelList: document.getElementById('model-list'),
  scrollToBottomBtn: document.getElementById('scroll-bottom-btn'),
  queueTray: document.getElementById('queue-tray-bar'),
  queueBadge: document.getElementById('queue-count-badge'),
  queueText: document.getElementById('queue-preview-text'),
  actionPromptCard: document.getElementById('action-prompt-card'),
  actionTitle: document.getElementById('action-title'),
  actionButtonsContainer: document.getElementById('action-buttons-container'),
  searchToggleBtn: document.getElementById('search-toggle-btn'),
  chatSearchBar: document.getElementById('chat-search-bar'),
  chatSearchInput: document.getElementById('chat-search-input'),
  searchCount: document.getElementById('search-count'),
  searchCloseBtn: document.getElementById('search-close-btn'),
  chatContent: document.getElementById('chatContent'),
  fileViewerOverlay: document.getElementById('fileViewerOverlay'),
  fileViewerDrawer: document.getElementById('fileViewerDrawer'),
  fileViewerFilename: document.getElementById('fileViewerFilename'),
  fileViewerSizeBadge: document.getElementById('fileViewerSizeBadge'),
  fileViewerTypeBadge: document.getElementById('fileViewerTypeBadge'),
  fileViewerPathPreview: document.getElementById('fileViewerPathPreview'),
  fileViewerBody: document.getElementById('fileViewerBody'),
  fileDownloadBtn: document.getElementById('fileDownloadBtn'),
  fileRawBtn: document.getElementById('fileRawBtn'),
  fileCopyBtn: document.getElementById('fileCopyBtn')
};

function haptic(ms = 15) {
  if (navigator.vibrate) {
    try { navigator.vibrate(ms); } catch (e) {}
  }
}

// ----------------------------------------------------------------------
// Theme Engine
// ----------------------------------------------------------------------
function applyTheme(themeName) {
  state.currentTheme = themeName;
  localStorage.setItem('ag_theme', themeName);
  document.body.className = `theme-${themeName}`;
}
applyTheme(state.currentTheme);

// ----------------------------------------------------------------------
// WebSocket Connection
// ----------------------------------------------------------------------
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    state.connected = true;
    updateStatus('Live', 'online');
    fetchLiveModels();
    loadSnapshot();
  };

  state.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWsEvent(data);
    } catch (e) {}
  };

  state.ws.onclose = () => {
    state.connected = false;
    updateStatus('Reconnecting...', 'offline');
    setTimeout(connectWebSocket, 3000);
  };

  state.ws.onerror = () => {
    state.connected = false;
  };
}

function handleWsEvent(msg) {
  switch (msg.event) {
    case 'snapshot_update':
      loadSnapshot();
      break;

    case 'init_state':
      state.messages = msg.payload.messages || [];
      state.agent = msg.payload.agent || { state: 'idle', busy: false };
      state.actions = msg.payload.actions || state.actions;
      loadSnapshot();
      renderMessages();
      updateAgentUI();
      updateActionsUI(state.actions);
      if (msg.payload.stats) updateTelemetryUI(msg.payload.stats);
      break;

    case 'message_new':
      const lastMsg = state.messages[state.messages.length - 1];
      if (!lastMsg || lastMsg.text !== msg.payload.text || lastMsg.from !== msg.payload.from) {
        state.messages.push(msg.payload);
        if (!state.searchQuery) {
          loadSnapshot();
        } else {
          appendMessageUI(msg.payload);
        }
      }
      break;

    case 'message_update':
      if (msg.payload && typeof msg.payload.index === 'number') {
        const idx = msg.payload.index;
        state.messages[idx] = msg.payload.message;
        const messageRows = elements.chatViewport.querySelectorAll('.message-row');
        if (messageRows[idx]) {
          const bubble = messageRows[idx].querySelector('.message-bubble');
          if (bubble) {
            bubble.innerHTML = renderMarkdown(msg.payload.message.text);
          }
        } else {
          renderMessages();
        }
        if (!state.userScrolledUp) scrollToBottom();
      }
      break;

    case 'agent_state':
      const wasBusy = state.agent.busy;
      state.agent = msg.payload;
      updateAgentUI();
      if (wasBusy && !state.agent.busy && state.messageQueue.length > 0) {
        dispatchQueuedMessage();
      }
      break;

    case 'actions_detected':
      state.actions = msg.payload;
      updateActionsUI(msg.payload);
      break;

    case 'telemetry_tick':
      updateTelemetryUI(msg.payload);
      break;

    case 'history_cleared':
      state.messages = [];
      renderMessages();
      updateStatus('Ready', 'online');
      break;
  }
}

function updateStatus(text, type) {
  if (!elements.statusDot) return;
  elements.statusDot.className = 'pulse-dot ' + (type === 'offline' ? 'offline' : (state.agent.busy ? 'busy' : ''));
}

function updateTelemetryUI(stats) {
  if (!stats) return;
  state.stats = stats;
  if (elements.cpuStat) elements.cpuStat.textContent = `${stats.cpu || 0}%`;
  
  const ramMb = stats.ramMb || (stats.ram && stats.ram.usedMb) || (typeof stats.ram === 'number' ? stats.ram : 0);
  if (elements.ramStat) elements.ramStat.textContent = `${ramMb}MB`;
  
  if (elements.cdpStatusStat) {
    elements.cdpStatusStat.textContent = stats.cdpConnected ? 'ONLINE' : 'STANDBY';
    elements.cdpStatusStat.style.color = stats.cdpConnected ? 'var(--emerald-glow)' : 'var(--rose-glow)';
  }

  // Keep user chosen model tier intact (do not auto-override with IDE base name)
  if (!state.activeModel && stats.activeModel) {
    state.activeModel = stats.activeModel;
    localStorage.setItem('ag_active_model', stats.activeModel);
    if (elements.modelLabel) elements.modelLabel.textContent = formatShortModelName(stats.activeModel);
  }
  
  if (stats.currentTarget) {
    state.activeTarget = stats.currentTarget;
    if (elements.targetLabel) {
      elements.targetLabel.textContent = stats.currentTarget === 'vm' ? 'VM' : 'Host';
    }
    const dot = elements.targetSwitchBtn ? elements.targetSwitchBtn.querySelector('.indicator-dot') : null;
    if (dot) {
      dot.className = `indicator-dot ${stats.currentTarget}`;
    }
  }
}

function updateAutoAcceptButtonUI(autoAccept) {
  if (!elements.autoAcceptBtn) return;
  if (!autoAccept || !autoAccept.available) {
    elements.autoAcceptBtn.style.display = 'none';
    return;
  }
  elements.autoAcceptBtn.style.display = 'inline-flex';
  if (autoAccept.enabled) {
    elements.autoAcceptBtn.innerHTML = '<span>Auto: ON</span>';
    elements.autoAcceptBtn.style.borderColor = 'var(--emerald)';
    elements.autoAcceptBtn.style.color = 'var(--emerald-glow)';
    elements.autoAcceptBtn.style.background = 'var(--emerald-dim)';
  } else {
    elements.autoAcceptBtn.innerHTML = '<span>Auto: OFF</span>';
    elements.autoAcceptBtn.style.borderColor = 'var(--border-glass)';
    elements.autoAcceptBtn.style.color = 'var(--text-secondary)';
    elements.autoAcceptBtn.style.background = 'rgba(255, 255, 255, 0.05)';
  }
}

async function toggleAutoAccept() {
  haptic(25);
  try {
    const res = await fetch('/api/auto-accept/toggle', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      state.actions.autoAccept.enabled = !state.actions.autoAccept.enabled;
      updateAutoAcceptButtonUI(state.actions.autoAccept);
    }
  } catch (e) {}
}

let actionsDismissed = false;

window.dismissActionPrompt = function() {
  haptic(15);
  actionsDismissed = true;
  if (elements.actionPromptCard) elements.actionPromptCard.style.display = 'none';
};

function updateActionsUI(actions) {
  if (!elements.actionPromptCard || !elements.actionButtonsContainer) return;
  
  if (actions.autoAccept) {
    updateAutoAcceptButtonUI(actions.autoAccept);
  }

  if (actionsDismissed) return;

  const question = actions.question;
  if (question && question.options && question.options.length > 0) {
    elements.actionPromptCard.style.display = 'flex';
    elements.actionPromptCard.style.flexDirection = 'column';
    if (elements.actionTitle) {
      elements.actionTitle.textContent = question.title || 'Interactive Choice Required:';
    }

    elements.actionButtonsContainer.innerHTML = '';
    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'question-options-list';

    question.options.forEach(opt => {
      const optCard = document.createElement('div');
      optCard.className = `question-opt-card ${opt.checked ? 'selected' : ''}`;
      optCard.onclick = async () => {
        haptic(20);
        document.querySelectorAll('.question-opt-card').forEach(c => c.classList.remove('selected'));
        optCard.classList.add('selected');
        await fetch('/api/actions/question/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ index: opt.id })
        });
      };
      optCard.innerHTML = `
        <div class="question-opt-radio">${opt.checked ? '●' : '○'}</div>
        <div class="question-opt-text">${opt.text}</div>
      `;
      optionsWrap.appendChild(optCard);
    });
    elements.actionButtonsContainer.appendChild(optionsWrap);

    const btnRow = document.createElement('div');
    btnRow.className = 'question-btn-row';

    if (question.canSubmit) {
      const submitBtn = document.createElement('button');
      submitBtn.className = 'chip-btn highlight';
      submitBtn.style.padding = '6px 14px';
      submitBtn.style.fontWeight = '700';
      submitBtn.textContent = 'Submit Choice ↵';
      submitBtn.onclick = async () => {
        haptic(35);
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
        await fetch('/api/actions/question/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isSkip: false })
        });
        elements.actionPromptCard.style.display = 'none';
        actionsDismissed = true;
        setTimeout(() => { actionsDismissed = false; syncChat(); }, 2000);
      };
      btnRow.appendChild(submitBtn);
    }

    if (question.canSkip) {
      const skipBtn = document.createElement('button');
      skipBtn.className = 'chip-btn stop-btn';
      skipBtn.style.padding = '6px 14px';
      skipBtn.style.fontWeight = '700';
      skipBtn.textContent = 'Skip';
      skipBtn.onclick = async () => {
        haptic(20);
        skipBtn.disabled = true;
        await fetch('/api/actions/question/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isSkip: true })
        });
        elements.actionPromptCard.style.display = 'none';
        actionsDismissed = true;
        setTimeout(() => { actionsDismissed = false; syncChat(); }, 2000);
      };
      btnRow.appendChild(skipBtn);
    }

    elements.actionButtonsContainer.appendChild(btnRow);
    if (!state.userScrolledUp) scrollToBottom();
    return;
  }

  const hasPrompt = !!actions.permissionPrompt;
  const hasButtons = actions.pendingButtons && actions.pendingButtons.length > 0;

  if (hasPrompt && hasButtons) {
    elements.actionPromptCard.style.display = 'flex';
    elements.actionPromptCard.style.flexDirection = 'column';
    if (elements.actionTitle) {
      elements.actionTitle.textContent = actions.permissionPrompt || 'Permission Required';
    }

    elements.actionButtonsContainer.innerHTML = '';
    const btns = actions.pendingButtons || [];
    btns.forEach(b => {
      const btnEl = document.createElement('button');
      const isPositive = ['allow', 'approve', 'proceed', 'run', 'review changes', 'accept', 'submit', 'yes'].some(k => b.text.toLowerCase().includes(k));
      const isNegative = ['deny', 'cancel', 'no'].some(k => b.text.toLowerCase().includes(k));
      
      btnEl.className = 'chip-btn ' + (isPositive ? 'highlight' : (isNegative ? 'stop-btn' : ''));
      btnEl.style.padding = '5px 12px';
      btnEl.style.fontWeight = '700';
      btnEl.textContent = b.text;
      
      btnEl.onclick = async () => {
        haptic(35);
        btnEl.disabled = true;
        btnEl.textContent = 'Executing...';
        await fetch('/api/actions/click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: b.text })
        });
        elements.actionPromptCard.style.display = 'none';
        actionsDismissed = true;
        setTimeout(() => { actionsDismissed = false; syncChat(); }, 2000);
      };
      
      elements.actionButtonsContainer.appendChild(btnEl);
    });

    if (!state.userScrolledUp) scrollToBottom();
  } else {
    elements.actionPromptCard.style.display = 'none';
  }
}

function updateAgentUI() {
  const isBusy = state.agent.busy;
  updateStatus(isBusy ? 'Agent Working...' : 'Live', isBusy ? 'busy' : 'online');
  
  if (elements.stopBtn) {
    elements.stopBtn.style.display = isBusy ? 'inline-flex' : 'none';
  }

  let workingBanner = document.getElementById('agent-working-banner');
  if (isBusy) {
    if (!workingBanner) {
      workingBanner = document.createElement('div');
      workingBanner.id = 'agent-working-banner';
      workingBanner.innerHTML = `
        <div style="display:flex; align-items:center; gap:7px;">
          <div class="neutral-pulse-dot"></div>
          <span style="font-size:11.5px; color:#94a3b8; font-weight:500;">Agent is thinking...</span>
        </div>
      `;
    }
    // Always keep workingBanner as the last child at the absolute bottom
    if (elements.chatViewport && elements.chatViewport.lastElementChild !== workingBanner) {
      elements.chatViewport.appendChild(workingBanner);
    }
    if (!state.userScrolledUp) scrollToBottom();
  } else {
    if (workingBanner) workingBanner.remove();
  }
}

async function toggleTarget() {
  haptic(30);
  const nextTarget = state.activeTarget === 'host' ? 'vm' : 'host';
  try {
    const res = await fetch('/api/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: nextTarget })
    });
    const data = await res.json();
    if (data.ok) {
      state.activeTarget = data.target;
      if (elements.targetLabel) {
        elements.targetLabel.textContent = data.target === 'vm' ? 'VM' : 'Host';
      }
      const dot = elements.targetSwitchBtn ? elements.targetSwitchBtn.querySelector('.indicator-dot') : null;
      if (dot) {
        dot.className = `indicator-dot ${data.target}`;
      }
      setTimeout(syncChat, 500);
    }
  } catch (e) {}
}

async function syncChat() {
  haptic(15);
  try {
    const res = await fetch('/api/sync-chat', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      console.log(`[SYNC] Synced ${data.count} messages from IDE.`);
    }
  } catch (e) {}
}

// ----------------------------------------------------------------------
// Markdown & Rich Content Renderer (GravityRemote2 High-Fidelity Flow)
// ----------------------------------------------------------------------
function renderMarkdown(text) {
  if (!text) return "";
  let raw = text.trim();

  // 1. Layer 1: Thought Badge & Execution Steps (Collapsible Rich Accordion)
  let thoughtHtml = "";
  
  // Format 1: Explicit <thought>...</thought>
  const thoughtTagMatch = raw.match(/<thought>([\s\S]*?)<\/thought>/i);
  if (thoughtTagMatch) {
    const thoughtContent = thoughtTagMatch[1].trim();
    raw = raw.replace(thoughtTagMatch[0], "").trim();
    thoughtHtml = `\n<details class="thought-card">\n<summary class="thought-summary">\n<span class="thought-title">Thought Process</span>\n<span class="thought-chevron">▾</span>\n</summary>\n<div class="thought-content">${thoughtContent.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>\n</details>\n\n`;
  } else {
    // Format 2: Thought for Xs / Worked for Xs
    const thoughtHeaderMatch = raw.match(/^(Thought for [0-9smh\s]+|Worked for [0-9smh\s]+|Thinking Process:?)/i);
    if (thoughtHeaderMatch) {
      const title = thoughtHeaderMatch[1].trim();
      raw = raw.slice(thoughtHeaderMatch[0].length).trim();

      let thoughtContent = "";
      if (raw.startsWith("```")) {
        thoughtContent = "";
      } else {
        const nextBlockIdx = raw.search(/\n\n(?=```|#{1,4}\s|🎯|🚀|🔬|🌊|✅|❌|⚡|🔍|All |Here |Check |Step |Note:|\$|\*\*|[A-Z][a-z]+ (?:is|was|has|have|completed|re-exported|downloaded|tested))/);
        if (nextBlockIdx > 0) {
          thoughtContent = raw.slice(0, nextBlockIdx).trim();
          raw = raw.slice(nextBlockIdx).trim();
        } else if (!raw.includes("```")) {
          if (raw.length < 200 && !raw.includes("\n\n")) {
            thoughtContent = raw;
            raw = "";
          }
        }
      }

      let formattedThought = (thoughtContent || "Completed internal reasoning and workspace analysis.")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");

      thoughtHtml = `\n<details class="thought-card">\n<summary class="thought-summary">\n<span class="thought-title">${title}</span>\n<span class="thought-chevron">▾</span>\n</summary>\n<div class="thought-content">${formattedThought}</div>\n</details>\n\n`;
    }
  }

  // Pre-protect existing explicit code blocks
  const preProtected = [];
  raw = raw.replace(/```[a-zA-Z0-9_-]*\n[\s\S]*?```/g, (m) => {
    const ph = `__PRE_PROTECTED_${preProtected.length}__`;
    preProtected.push(m);
    return ph;
  });

  // Layer 1.5: Box remaining un-fenced terminal commands & tool traces
  const actionStepPattern = /^(?:Explored|Exploring|Edited|Editing|Analyzed|Analyzing|Ran|Run|Running|Built|Building|Created|Updated|Deleted|Viewed|Viewing)\b/i;
  const cliPrefixPattern = /^(?:(?:\$|~|\/home|\/tmp|\/var)\/|[a-z0-9_\-\.]+@|>>>|\$\s+)/i;
  const toolCmdPattern = /^(?:git|npm|npx|node|python3?|bash|sh|cat|grep|curl|echo|systemctl|journalctl|ssh|scp|find|sed|awk|chmod|chown|mkdir|touch|rm|cp|mv|lsof|ss|pnpm|yarn|ip|ls|ps|df|free|top|kill|docker|tar|ping|sudo|which|whereis|env|export|source|wget)\s+/i;
  const diffPattern = /^(?:\+{3}|\-{3}|@{2}|\+[0-9]+|\-[0-9]+|\+\s*#|\+\s*[a-zA-Z0-9_\$]|<truncated)/;
  const statPattern = /^[0-9]+\s+(?:commands|files|tasks|folders|errors|warnings)\b/i;
  const proseBoundaryPattern = /^(?:#{1,4}\s|[-*]\s|\d+\.\s|>\s|\*\*[^*]+\*\*\s*:)/;

  const isCommandStart = (trimmed) => {
    if (!trimmed) return false;
    return actionStepPattern.test(trimmed) ||
           cliPrefixPattern.test(trimmed) ||
           toolCmdPattern.test(trimmed) ||
           diffPattern.test(trimmed) ||
           statPattern.test(trimmed);
  };

  const lines = raw.split('\n');
  const resultLines = [];
  let inCommandBlock = false;
  let currentCmdLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!inCommandBlock) {
      if (isCommandStart(trimmed)) {
        inCommandBlock = true;
        currentCmdLines.push(line);
      } else {
        resultLines.push(line);
      }
    } else {
      if (proseBoundaryPattern.test(trimmed) || (trimmed === '' && lines[i+1] && proseBoundaryPattern.test(lines[i+1].trim()))) {
        resultLines.push('```bash\n' + currentCmdLines.join('\n').trim() + '\n```');
        currentCmdLines = [];
        inCommandBlock = false;
        resultLines.push(line);
      } else {
        currentCmdLines.push(line);
      }
    }
  }

  if (inCommandBlock && currentCmdLines.length > 0) {
    resultLines.push('```bash\n' + currentCmdLines.join('\n').trim() + '\n```');
  }

  raw = resultLines.join('\n');
  preProtected.forEach((b, idx) => {
    raw = raw.replace(`__PRE_PROTECTED_${idx}__`, b);
  });

  // 2. Layer 2: Explicit Code Blocks & Tools
  const codeBlocks = [];
  raw = raw.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    const langLabel = lang || "code";
    let formattedCode = code.trim()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    codeBlocks.push(`
      <div class="code-container">
        <div class="code-header">
          <span>${langLabel}</span>
          <button class="copy-btn" onclick="copyCode(this)">Copy</button>
        </div>
        <pre><code class="language-${langLabel}">${formattedCode}</code></pre>
      </div>
    `);
    return placeholder;
  });

  // 3. Layer 3: LaTeX Math (Formulas & Equations)
  const mathBlocks = [];
  raw = raw.replace(/\$\$([\s\S]*?)\$\$/g, (m, math) => {
    const placeholder = `__MATH_BLOCK_${mathBlocks.length}__`;
    let clean = math
      .replace(/\\mathbf\{([^}]+)\}/g, "<strong>$1</strong>")
      .replace(/\\text\{([^}]+)\}/g, "$1")
      .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1 / $2)")
      .replace(/\\begin\{aligned\}|\\end\{aligned\}/g, "")
      .replace(/\\times/g, "×")
      .replace(/\\div/g, "÷")
      .replace(/\\approx/g, "≈")
      .replace(/\\le(q)?/g, "≤")
      .replace(/\\ge(q)?/g, "≥")
      .replace(/\\dots/g, "…")
      .replace(/\\sqrt\{([^}]+)\}/g, "√($1)")
      .replace(/\^2/g, "²")
      .replace(/\^3/g, "³")
      .replace(/\^([0-9]+)/g, "<sup>$1</sup>")
      .replace(/\\\\/g, "<br>")
      .replace(/&/g, "&amp;")
      .trim();
    mathBlocks.push(`\n<div class="math-block">${clean}</div>\n`);
    return placeholder;
  });

  raw = raw.replace(/\$([^$\n]+)\$/g, (m, math) => {
    const placeholder = `__MATH_BLOCK_${mathBlocks.length}__`;
    let clean = math
      .replace(/\\mathbf\{([^}]+)\}/g, "<strong>$1</strong>")
      .replace(/\\text\{([^}]+)\}/g, "$1")
      .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1 / $2)")
      .replace(/\\times/g, "×")
      .replace(/\\div/g, "÷")
      .replace(/\\approx/g, "≈")
      .replace(/\\le(q)?/g, "≤")
      .replace(/\\ge(q)?/g, "≥")
      .replace(/\^2/g, "²")
      .replace(/\^3/g, "³")
      .replace(/\^([0-9]+)/g, "<sup>$1</sup>")
      .trim();
    mathBlocks.push(`<span class="math-inline">${clean}</span>`);
    return placeholder;
  });

  // 4. Layer 4: HTML Escape & Structured Typography
  let answerHtml = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Headings
  answerHtml = answerHtml.replace(/^### (.*$)/gim, '<h3 class="prose-h3">$1</h3>');
  answerHtml = answerHtml.replace(/^## (.*$)/gim, '<h2 class="prose-h2">$1</h2>');
  answerHtml = answerHtml.replace(/^# (.*$)/gim, '<h1 class="prose-h1">$1</h1>');

  // Dividers
  answerHtml = answerHtml.replace(/^---$/gim, '<hr class="prose-hr">');

  // Blockquotes
  answerHtml = answerHtml.replace(/^> (.*$)/gim, '<blockquote class="prose-quote">$1</blockquote>');

  // Unordered Lists
  answerHtml = answerHtml.replace(/(?:^[ \t]*[-*] .+(?:\n[ \t]*[-*] .+)*)/gm, (listBlock) => {
    const items = listBlock.split("\n").map(li => li.replace(/^[ \t]*[-*] /, "").trim()).filter(Boolean);
    return `<ul class="prose-ul">${items.map(it => `<li>${it}</li>`).join("")}</ul>`;
  });

  // Ordered Lists
  answerHtml = answerHtml.replace(/(?:^[ \t]*\d+\. .+(?:\n[ \t]*\d+\. .+)*)/gm, (listBlock) => {
    const items = listBlock.split("\n").map(li => li.replace(/^[ \t]*\d+\. /, "").trim()).filter(Boolean);
    return `<ol class="prose-ol">${items.map(it => `<li>${it}</li>`).join("")}</ol>`;
  });

  // Inline formatting
  answerHtml = answerHtml.replace(/`([^`]+)`/g, '<code class="prose-code">$1</code>');
  answerHtml = answerHtml.replace(/\*\*([^\*]+)\*\*/g, '<strong class="prose-strong">$1</strong>');
  answerHtml = answerHtml.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
  answerHtml = answerHtml.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="prose-a">$1</a>');

  // Restore placeholders
  mathBlocks.forEach((mbHtml, idx) => {
    answerHtml = answerHtml.replace(`__MATH_BLOCK_${idx}__`, mbHtml);
  });
  codeBlocks.forEach((cbHtml, idx) => {
    answerHtml = answerHtml.replace(`__CODE_BLOCK_${idx}__`, cbHtml);
  });

  const rawParagraphs = answerHtml.split(/\n\n+/);
  const formattedAnswer = rawParagraphs.map(p => {
    const trimmed = p.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("<details") || trimmed.startsWith("<div") || trimmed.startsWith("<h") ||
        trimmed.startsWith("<table") || trimmed.startsWith("<ul") || trimmed.startsWith("<ol") ||
        trimmed.startsWith("<blockquote") || trimmed.startsWith("<hr") || trimmed.startsWith("<span class=\"math-inline\"")) {
      return trimmed;
    }
    return `<p class="prose-p">${trimmed.replace(/\n/g, "<br>")}</p>`;
  }).filter(Boolean).join("");

  return (thoughtHtml + formattedAnswer).trim();
}

window.copyCode = function(btn) {
  haptic(20);
  const pre = btn.closest('.code-container').querySelector('pre code');
  if (pre) {
    navigator.clipboard.writeText(pre.innerText).then(() => {
      btn.textContent = 'Copied';
      setTimeout(() => btn.textContent = 'Copy', 2000);
    });
  }
};

// ----------------------------------------------------------------------
// Chat Feed & Mobile DOM Memory Trimming (Sliding Window v3.4)
// ----------------------------------------------------------------------
function renderMessages() {
  if (!elements.chatViewport) return;

  if (!state.searchQuery) {
    let cc = document.getElementById('chatContent');
    if (!cc) {
      elements.chatViewport.innerHTML = '<div class="chat-content" id="chatContent"></div>';
      elements.chatContent = document.getElementById('chatContent');
      if (typeof setupChatContentInteractions === 'function') setupChatContentInteractions();
    }
    loadSnapshot();
    return;
  }

  // Active Search Filter View
  elements.chatViewport.innerHTML = '';
  const filtered = state.messages.filter(m => m.text.toLowerCase().includes(state.searchQuery.toLowerCase()));

  if (elements.searchCount) {
    elements.searchCount.textContent = `${filtered.length}/${state.messages.length}`;
  }

  if (filtered.length === 0) {
    elements.chatViewport.innerHTML = `
      <div style="text-align:center; padding: 40px 20px; color:var(--text-tertiary);">
        <div style="font-size:13px;">No messages matching "${escapeHtml(state.searchQuery)}"</div>
      </div>
    `;
    return;
  }

  // Calculate sliding window
  const total = filtered.length;
  const startIndex = Math.max(0, total - state.visibleLimit);
  const visibleMessages = filtered.slice(startIndex);

  // If older messages exist, prepend the interactive Load Earlier banner
  if (startIndex > 0) {
    const banner = document.createElement('div');
    banner.id = 'load-earlier-banner';
    banner.className = 'load-earlier-banner';
    banner.innerHTML = `<span>⬆ Load earlier messages (${startIndex} older)</span>`;
    banner.onclick = loadEarlierMessages;
    elements.chatViewport.appendChild(banner);
  }

  for (const msg of visibleMessages) {
    appendMessageUI(msg, false);
  }

  if (state.agent.busy) {
    let workingBanner = document.getElementById('agent-working-banner');
    if (!workingBanner) {
      workingBanner = document.createElement('div');
      workingBanner.id = 'agent-working-banner';
      workingBanner.innerHTML = `
        <div style="display:flex; align-items:center; gap:7px;">
          <div class="neutral-pulse-dot"></div>
          <span style="font-size:11.5px; color:#94a3b8; font-weight:500;">Agent is thinking...</span>
        </div>
      `;
    }
    elements.chatViewport.appendChild(workingBanner);
  }

  if (!state.userScrolledUp) {
    scrollToBottom();
  }
}

window.loadEarlierMessages = function() {
  haptic(15);
  const oldScrollHeight = elements.chatViewport.scrollHeight;
  const oldScrollTop = elements.chatViewport.scrollTop;

  state.visibleLimit += 50;
  renderMessages();

  // Preserve scroll offset so the screen does not jump
  const newScrollHeight = elements.chatViewport.scrollHeight;
  elements.chatViewport.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
};

function appendMessageUI(msg, scroll = true) {
  if (!elements.chatViewport) return;
  if (!state.searchQuery) {
    loadSnapshot();
    return;
  }

  const isUser = msg.from === "user";
  const row = document.createElement("div");
  row.className = `message-row ${isUser ? "user" : "agent"}`;

  const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.innerHTML = `
    <span class="message-avatar-tag">${isUser ? "You" : "Antigravity"}</span>
    <span>•</span>
    <span>${timeStr}</span>
  `;
  row.appendChild(meta);

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.innerHTML = isUser ? escapeHtml(msg.text) : renderMarkdown(msg.text);
  bubble.onclick = () => openMessageActions(bubble, msg.text);
  row.appendChild(bubble);

  elements.chatViewport.appendChild(row);

  // Dynamic DOM Trimming: keep active DOM bounded to prevent mobile Chrome tab discarding
  if (!state.searchQuery && !state.userScrolledUp) {
    const rows = elements.chatViewport.querySelectorAll('.message-row');
    if (rows.length > state.visibleLimit + 10) {
      const excess = rows.length - state.visibleLimit;
      for (let i = 0; i < excess; i++) {
        rows[i].remove();
      }
      let banner = document.getElementById('load-earlier-banner');
      const hiddenCount = state.messages.length - state.visibleLimit;
      if (hiddenCount > 0) {
        if (!banner) {
          banner = document.createElement('div');
          banner.id = 'load-earlier-banner';
          banner.className = 'load-earlier-banner';
          banner.onclick = loadEarlierMessages;
          elements.chatViewport.insertBefore(banner, elements.chatViewport.firstChild);
        }
        banner.innerHTML = `<span>⬆ Load earlier messages (${hiddenCount} older)</span>`;
      }
    }
  }

  if (scroll) {
    if (state.userScrolledUp) {
      if (elements.scrollToBottomBtn) elements.scrollToBottomBtn.style.display = 'flex';
    } else {
      scrollToBottom();
    }
  }
}

window.openMessageActions = function(el, text) {
  haptic(15);
};

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

function scrollToBottom() {
  if (!elements.chatViewport) return;
  requestAnimationFrame(() => {
    elements.chatViewport.scrollTop = elements.chatViewport.scrollHeight + 300;
  });
  state.userScrolledUp = false;
  if (elements.scrollToBottomBtn) elements.scrollToBottomBtn.style.display = 'none';
}

function handleScrollDetection() {
  if (!elements.chatViewport) return;
  const isNearBottom = elements.chatViewport.scrollHeight - elements.chatViewport.scrollTop - elements.chatViewport.clientHeight < 250;
  state.userScrolledUp = !isNearBottom;
  if (elements.scrollToBottomBtn) {
    elements.scrollToBottomBtn.style.display = state.userScrolledUp ? 'flex' : 'none';
  }
}

// ----------------------------------------------------------------------
// Send Message & Queueing
// ----------------------------------------------------------------------
async function sendMessage() {
  const text = (elements.promptInput.value || '').trim();
  if (!text) return;

  haptic(30);
  elements.promptInput.value = '';
  elements.promptInput.style.height = '32px';

  if (state.agent.busy) {
    state.messageQueue.push(text);
    updateQueueUI();
    return;
  }

  await postMessageDirect(text);
}

async function postMessageDirect(text) {
  appendOptimisticUserBubble(text);
  burstLoadSnapshot();

  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model: state.activeModel,
        mode: state.agentMode
      })
    });
    burstLoadSnapshot();
    const data = await res.json();
    if (!data.ok) {
      console.error('[SEND_ERR]', data);
    }
  } catch (err) {
    console.error('[SEND_EXCEPTION]', err);
  }
}

function updateQueueUI() {
  if (!elements.queueTray) return;
  if (state.messageQueue.length > 0) {
    elements.queueTray.style.display = 'flex';
    elements.queueBadge.textContent = state.messageQueue.length;
    elements.queueText.textContent = `Queued: "${state.messageQueue[0].slice(0, 24)}..."`;
  } else {
    elements.queueTray.style.display = 'none';
  }
}

function dispatchQueuedMessage() {
  if (state.messageQueue.length === 0) return;
  const nextMsg = state.messageQueue.shift();
  updateQueueUI();
  postMessageDirect(nextMsg);
}

window.sendQueuedNow = function() {
  haptic(25);
  if (state.messageQueue.length === 0) return;
  const nextMsg = state.messageQueue.shift();
  updateQueueUI();
  postMessageDirect(nextMsg);
};

window.clearMessageQueue = function() {
  haptic(20);
  state.messageQueue = [];
  updateQueueUI();
};

window.insertQuickPrompt = function(promptText) {
  haptic(20);
  elements.promptInput.value = promptText;
  elements.promptInput.focus();
};

// ----------------------------------------------------------------------
// Master Suite Drawer Controller
// ----------------------------------------------------------------------
window.switchDrawerTab = function(tabName) {
  haptic(20);
  state.drawerActiveTab = tabName;
  document.querySelectorAll('.drawer-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
  });
  renderDrawerContent();
};

async function renderDrawerContent() {
  if (!elements.drawerBody) return;
  elements.drawerBody.innerHTML = '<div style="text-align:center; padding:25px; color:var(--text-tertiary);">Loading...</div>';

  try {
    const res = await fetch('/api/antigravity/features');
    const data = await res.json();
    state.agFeatures = data;

    switch (state.drawerActiveTab) {
      case 'plan':
        renderPlanTab(data);
        break;
      case 'lens':
        renderLensTab();
        break;
      case 'terminal':
        renderTerminalTab();
        break;
      case 'tabs':
        renderEditorTabs();
        break;
      case 'kis':
        renderKnowledgeTab(data.knowledgeItems || []);
        break;
      case 'daemons':
        renderDaemonsTab();
        break;
      case 'slash':
        renderSlashTab(data.slashCommands || []);
        break;
      case 'models':
        renderDrawerModelsTab();
        break;
      case 'themes':
        renderThemesTab();
        break;
    }
  } catch (e) {
    elements.drawerBody.innerHTML = '<div style="color:var(--rose-glow); padding:20px;">Failed to load suite features.</div>';
  }
}

function renderPlanTab(data) {
  const plan = data.plan;
  const walkthrough = data.walkthrough;

  if (!plan && !walkthrough) {
    elements.drawerBody.innerHTML = `
      <div style="text-align:center; padding: 35px 10px; color:var(--text-secondary);">
        <div style="font-weight:700; font-size:15px; margin-bottom:4px;">No Active Plan</div>
        <div style="font-size:12px; color:var(--text-tertiary);">Trigger complex tasks to generate interactive plans.</div>
      </div>
    `;
    return;
  }

  let html = '';
  if (plan) {
    html += `
      <div style="background:var(--bg-card); border:1px solid var(--border-glass); border-radius:var(--radius-xs); padding:12px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-size:11.5px; font-weight:800; color:var(--emerald-glow);">ACTIVE IMPLEMENTATION PLAN</span>
        </div>
        <div style="font-size:13px; line-height:1.5;">${renderMarkdown(plan)}</div>
        <div class="plan-action-bar">
          <button class="approve-btn" onclick="approvePlan()">Proceed & Execute</button>
          <button class="reject-btn" onclick="rejectPlan()">Feedback / Revise</button>
        </div>
      </div>
    `;
  }

  if (walkthrough) {
    html += `
      <div style="background:var(--bg-card); border:1px solid var(--border-glass); border-radius:var(--radius-xs); padding:12px;">
        <div style="font-size:11.5px; font-weight:800; color:var(--cyan-glow); margin-bottom:6px;">LATEST WALKTHROUGH</div>
        <div style="font-size:13px; line-height:1.5;">${renderMarkdown(walkthrough)}</div>
      </div>
    `;
  }

  elements.drawerBody.innerHTML = html;
}

window.approvePlan = async function() {
  haptic(35);
  closeDrawer();
  await fetch('/api/plan/approve', { method: 'POST' });
};

window.rejectPlan = async function() {
  haptic(20);
  const feedback = prompt('Enter your revision feedback for the plan:');
  if (feedback !== null) {
    closeDrawer();
    await fetch('/api/plan/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback })
    });
  }
};

function renderLensTab() {
  elements.drawerBody.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:11.5px; font-weight:700; color:var(--emerald-glow);">LIVE DESKTOP STREAM</span>
        <div style="display:flex; gap:5px; align-items:center;">
          <select id="lens-interval-select" onchange="setLensInterval(this.value)" style="background:rgba(0,0,0,0.5); border:1px solid var(--border-glass); color:#fff; font-size:10.5px; padding:3px 6px; border-radius:var(--radius-xs);">
            <option value="0">Auto: OFF</option>
            <option value="1000">Auto: 1s</option>
            <option value="3000">Auto: 3s</option>
            <option value="5000">Auto: 5s</option>
          </select>
          <button onclick="refreshLens()" class="chip-btn highlight" style="padding:2px 8px; font-size:10px; height:24px;">Refresh</button>
        </div>
      </div>

      <div style="position:relative; background:#000; border:1px solid var(--border-glass); border-radius:var(--radius-xs); overflow:hidden; min-height:200px; display:flex; align-items:center; justify-content:center; cursor:pointer;" onclick="openLensModal()">
        <img id="lens-preview-img" src="/api/screenshot?raw=true&t=${Date.now()}" alt="Visual Lens" style="width:100%; height:auto; display:block;" onerror="this.src=''; this.alt='Snapshot failed.'">
      </div>
      <div style="font-size:10.5px; color:var(--text-tertiary); text-align:center;">Tap screenshot to open fullscreen high-res zoom.</div>
    </div>
  `;
}

window.refreshLens = function() {
  haptic(15);
  const img = document.getElementById('lens-preview-img');
  if (img) img.src = `/api/screenshot?raw=true&t=${Date.now()}`;
};

window.setLensInterval = function(val) {
  const ms = parseInt(val);
  state.lensAutoRefreshInterval = ms;
  if (state.lensTimer) clearInterval(state.lensTimer);
  if (ms > 0) {
    state.lensTimer = setInterval(refreshLens, ms);
  }
};

window.openLensModal = function() {
  haptic(25);
  if (elements.lensModal && elements.lensModalImg) {
    elements.lensModalImg.src = `/api/screenshot?raw=true&quality=90&t=${Date.now()}`;
    elements.lensModal.style.display = 'flex';
  }
};

window.closeLensModal = function() {
  if (elements.lensModal) elements.lensModal.style.display = 'none';
};

function renderTerminalTab() {
  elements.drawerBody.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:11.5px; font-weight:700; color:var(--cyan-glow);">QUICK REMOTE TERMINAL</span>
        <button onclick="clearTerminalOutput()" style="background:none; border:none; color:var(--text-tertiary); font-size:10.5px; cursor:pointer;">Clear</button>
      </div>

      <div class="quick-action-carousel" style="margin-bottom:2px;">
        <button class="chip-btn" onclick="execTerminalSnippet('uptime; free -h')">Uptime</button>
        <button class="chip-btn" onclick="execTerminalSnippet('git status')">Git Status</button>
        <button class="chip-btn" onclick="execTerminalSnippet('df -h')">Disk Space</button>
        <button class="chip-btn" onclick="execTerminalSnippet('journalctl --user -u antigravity-phone-chat -n 15 --no-pager')">Phone Logs</button>
      </div>

      <div style="display:flex; gap:5px;">
        <input type="text" id="terminal-input" placeholder="Command..." style="flex:1; background:rgba(0,0,0,0.6); border:1px solid var(--border-glass); border-radius:var(--radius-xs); padding:6px 10px; font-family:var(--font-mono); font-size:12px; color:#fff; outline:none;" onkeydown="handleTerminalKey(event)">
        <button onclick="runTerminalCmd()" class="chip-btn highlight" style="padding:6px 12px; font-weight:700; height:28px;">Run</button>
      </div>

      <pre id="terminal-output" style="background:#020408; border:1px solid var(--border-glass); border-radius:var(--radius-xs); padding:10px; font-family:var(--font-mono); font-size:11px; line-height:1.4; color:#a7f3d0; max-height:240px; overflow:auto; white-space:pre-wrap;">Terminal Ready.\n</pre>
    </div>
  `;
}

window.handleTerminalKey = function(e) {
  if (e.key === 'Enter') {
    runTerminalCmd();
  } else if (e.key === 'ArrowUp') {
    if (state.terminalHistory.length > 0) {
      state.terminalHistoryIndex = Math.min(state.terminalHistoryIndex + 1, state.terminalHistory.length - 1);
      e.target.value = state.terminalHistory[state.terminalHistory.length - 1 - state.terminalHistoryIndex] || '';
    }
  } else if (e.key === 'ArrowDown') {
    if (state.terminalHistoryIndex > 0) {
      state.terminalHistoryIndex--;
      e.target.value = state.terminalHistory[state.terminalHistory.length - 1 - state.terminalHistoryIndex] || '';
    } else {
      state.terminalHistoryIndex = -1;
      e.target.value = '';
    }
  }
};

window.execTerminalSnippet = function(cmd) {
  const inp = document.getElementById('terminal-input');
  if (inp) {
    inp.value = cmd;
    runTerminalCmd();
  }
};

window.runTerminalCmd = async function() {
  const inp = document.getElementById('terminal-input');
  const out = document.getElementById('terminal-output');
  if (!inp || !inp.value.trim() || !out) return;

  const cmd = inp.value.trim();
  state.terminalHistory.push(cmd);
  state.terminalHistoryIndex = -1;
  inp.value = '';

  out.textContent += `\n$ ${cmd}\n`;
  haptic(15);

  try {
    const res = await fetch('/api/terminal/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd })
    });
    const data = await res.json();
    if (data.stdout) out.textContent += data.stdout;
    if (data.stderr) out.textContent += `\n[STDERR]\n${data.stderr}`;
    out.scrollTop = out.scrollHeight;
  } catch (e) {
    out.textContent += `\n[ERROR: ${e.message}]\n`;
  }
};

window.clearTerminalOutput = function() {
  const out = document.getElementById('terminal-output');
  if (out) out.textContent = 'Terminal cleared.\n';
};

async function renderEditorTabs() {
  const res = await fetch('/api/tabs');
  const data = await res.json();
  const tabs = data.tabs || [];

  if (tabs.length === 0) {
    elements.drawerBody.innerHTML = '<div style="text-align:center; padding:25px; color:var(--text-tertiary);">No open editor tabs.</div>';
    return;
  }

  let html = '<div style="display:flex; flex-direction:column; gap:6px;">';
  tabs.forEach(t => {
    html += `
      <div class="model-item ${t.active ? 'active' : ''}" onclick="focusEditorTab(${t.index})">
        <div>
          <div style="font-weight:700; font-size:12.5px; color:#fff;">${t.title}</div>
          <div style="font-size:10.5px; color:var(--text-tertiary);">${t.active ? 'Active' : 'Background'}</div>
        </div>
        <button class="chip-btn ${t.active ? 'highlight' : ''}" style="font-size:10px; height:22px; padding:2px 8px;">Focus</button>
      </div>
    `;
  });
  html += '</div>';
  elements.drawerBody.innerHTML = html;
}

window.focusEditorTab = async function(idx) {
  haptic(25);
  await fetch('/api/tabs/focus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index: idx })
  });
  renderEditorTabs();
};

function renderKnowledgeTab(kis) {
  let html = `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <input type="text" id="ki-search-input" placeholder="Filter Knowledge Items..." oninput="filterKis(this.value)" style="background:rgba(0,0,0,0.5); border:1px solid var(--border-glass); padding:6px 10px; border-radius:var(--radius-xs); color:#fff; font-size:12px; outline:none;">
      <div id="kis-list-container" style="display:flex; flex-direction:column; gap:6px;">
  `;

  kis.forEach(k => {
    html += `
      <div class="model-item ki-card-item" data-title="${k.title.toLowerCase()}" data-summary="${k.summary.toLowerCase()}" onclick="inspectKnowledge('${k.id}')">
        <div>
          <div style="font-weight:700; font-size:12.5px; color:var(--emerald-glow);">${k.title}</div>
          <div style="font-size:11px; color:var(--text-secondary); line-height:1.35; margin-top:2px;">${k.summary || 'Knowledge item context'}</div>
        </div>
      </div>
    `;
  });

  html += '</div></div>';
  elements.drawerBody.innerHTML = html;
}

window.filterKis = function(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.ki-card-item').forEach(card => {
    const title = card.getAttribute('data-title') || '';
    const summary = card.getAttribute('data-summary') || '';
    card.style.display = (title.includes(q) || summary.includes(q)) ? 'flex' : 'none';
  });
};

window.inspectKnowledge = async function(kiId) {
  haptic(20);
  try {
    const res = await fetch(`/api/knowledge/${kiId}`);
    const data = await res.json();
    if (data.ok) {
      alert(`${data.meta.title || kiId}\n\n${data.meta.summary || 'No detailed summary.'}`);
    }
  } catch (e) {}
};

async function renderDaemonsTab() {
  const res = await fetch('/api/daemons');
  const data = await res.json();
  const daemons = data.daemons || [];

  if (daemons.length === 0) {
    elements.drawerBody.innerHTML = '<div style="text-align:center; padding:25px; color:var(--text-tertiary);">No background worker daemons detected.</div>';
    return;
  }

  let html = '<div style="display:flex; flex-direction:column; gap:6px;">';
  daemons.forEach(d => {
    html += `
      <div class="model-item" style="align-items:flex-start;">
        <div style="flex:1;">
          <div style="font-family:var(--font-mono); font-size:10.5px; font-weight:700; color:var(--cyan-glow);">PID ${d.pid} • CPU: ${d.cpu}% • MEM: ${d.mem}%</div>
          <div style="font-size:11.5px; color:var(--text-primary); margin-top:3px; word-break:break-all;">${d.cmd}</div>
        </div>
        <button class="chip-btn stop-btn" onclick="killDaemon(${d.pid})" style="padding:3px 8px; font-size:9.5px; margin-left:6px; height:22px;">Kill</button>
      </div>
    `;
  });
  html += '</div>';
  elements.drawerBody.innerHTML = html;
}

window.killDaemon = async function(pid) {
  haptic(30);
  if (confirm(`Kill background PID ${pid}?`)) {
    await fetch('/api/daemons/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid })
    });
    renderDaemonsTab();
  }
};

function renderSlashTab(slashCmds) {
  let html = '<div style="display:flex; flex-direction:column; gap:6px;">';
  slashCmds.forEach(s => {
    html += `
      <div class="model-item" onclick="triggerSlashCommand('${s.cmd}')">
        <div>
          <div style="font-weight:700; font-size:12.5px; color:var(--purple-glow); font-family:var(--font-mono);">${s.cmd} — ${s.title}</div>
          <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">${s.desc}</div>
        </div>
        <button class="chip-btn highlight" style="font-size:10px; height:22px; padding:2px 8px;">Trigger</button>
      </div>
    `;
  });
  html += '</div>';
  elements.drawerBody.innerHTML = html;
}

window.triggerSlashCommand = function(cmd) {
  haptic(25);
  closeDrawer();
  elements.promptInput.value = `${cmd} `;
  elements.promptInput.focus();
};

function renderThemesTab() {
  const themes = [
    { id: 'gr2', name: 'GravityRemote2 Classic', desc: 'Original Phone Chat VS Code Dark+ slate aesthetic', color: '#22c55e' },
    { id: 'matrix', name: 'Matrix Emerald', desc: 'Neon green cyberpunk aesthetic', color: '#10b981' },
    { id: 'cyber', name: 'Cyber Cyan', desc: 'Electric blue and cyan highlights', color: '#06b6d4' },
    { id: 'oled', name: 'OLED Obsidian', desc: 'True pitch-black pure contrast', color: '#64748b' },
    { id: 'sunset', name: 'Sunset Amber', desc: 'Warm titanium golden amber aura', color: '#f59e0b' }
  ];

  const banner = document.getElementById('lisanBanners');
  const isBannerVisible = banner ? (!banner.classList.contains('hidden') && !banner.classList.contains('collapsed')) : (localStorage.getItem('ag_lisan_collapsed') !== 'true');

  let html = '<div style="display:flex; flex-direction:column; gap:6px;">';
  
  // Lisan Banner Toggle in Drawer
  html += `
    <div class="theme-card" onclick="toggleLisanBanner()" style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; margin-bottom:8px; border:1px solid ${isBannerVisible ? 'rgba(51,255,51,0.3)' : 'var(--border)'}; background: ${isBannerVisible ? 'rgba(51,255,51,0.06)' : 'rgba(255,255,255,0.02)'}; border-radius:10px; cursor:pointer;">
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="width:10px; height:10px; border-radius:50%; background:#33ff33; box-shadow:0 0 8px #33ff33;"></div>
        <div>
          <div style="font-size:12.5px; font-weight:600; color:var(--text-primary);">لِسَان العَرَب Stream Banner</div>
          <div style="font-size:10.5px; color:var(--text-tertiary);">Tap banner in header to hide anytime</div>
        </div>
      </div>
      <span style="font-size:11px; font-weight:700; color:${isBannerVisible ? '#33ff33' : 'var(--text-tertiary)'}; background:rgba(0,0,0,0.4); padding:3px 8px; border-radius:6px; border:1px solid var(--border);">
        ${isBannerVisible ? 'Visible ●' : 'Hidden ○'}
      </span>
    </div>
  `;

  themes.forEach(th => {
    html += `
      <div class="theme-card ${state.currentTheme === th.id ? 'active' : ''}" onclick="selectTheme('${th.id}')" style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:10px; height:10px; border-radius:50%; background:${th.color}; box-shadow:0 0 8px ${th.color};"></div>
          <div>
            <div style="font-size:12.5px; font-weight:600; color:var(--text-primary);">${th.name}</div>
            <div style="font-size:10.5px; color:var(--text-tertiary);">${th.desc}</div>
          </div>
        </div>
        ${state.currentTheme === th.id ? '<span style="color:var(--emerald-glow); font-size:13px; font-weight:700;">Active</span>' : ''}
      </div>
    `;
  });
  html += '</div>';
  elements.drawerBody.innerHTML = html;
}

window.selectTheme = function(themeId) {
  haptic(25);
  applyTheme(themeId);
  renderThemesTab();
};

function openDrawer() {
  haptic(20);
  if (elements.drawerOverlay) elements.drawerOverlay.style.display = 'block';
  renderDrawerContent();
}

function closeDrawer() {
  if (elements.drawerOverlay) elements.drawerOverlay.style.display = 'none';
  if (state.lensTimer) clearInterval(state.lensTimer);
}

// ----------------------------------------------------------------------
// Models Modal
// ----------------------------------------------------------------------
async function fetchLiveModels() {
  try {
    const saved = localStorage.getItem('ag_active_model');
    if (saved) {
      state.activeModel = saved;
      if (elements.modelLabel) elements.modelLabel.textContent = formatShortModelName(saved);
    }
    const res = await fetch('/api/models');
    const data = await res.json();
    if (data.ok) {
      if (data.current && !saved) {
        state.activeModel = data.current;
        if (elements.modelLabel) elements.modelLabel.textContent = formatShortModelName(data.current);
      }
      state.modelsList = data.models || DEFAULT_MODELS;
    }
  } catch (e) {}
}

function normalizeModelStr(str) {
  return (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function generateModelFamiliesHtml() {
  let html = "";
  const normActive = normalizeModelStr(state.activeModel);

  MODEL_FAMILIES.forEach(fam => {
    const isFamilyActive = fam.tiers.some(t => {
      const normTier = normalizeModelStr(t.fullName);
      return normActive === normTier || (normActive.startsWith(normalizeModelStr(fam.name)) && normActive.includes(normalizeModelStr(t.name)));
    });

    let tiersHtml = "";
    fam.tiers.forEach(tier => {
      const normTier = normalizeModelStr(tier.fullName);
      let isTierActive = normActive === normTier;
      if (!isTierActive && isFamilyActive && normActive.includes(normalizeModelStr(tier.name))) {
        isTierActive = true;
      }
      // Exact match or contains check
      if (!isTierActive && isFamilyActive && normActive.includes(normalizeModelStr(tier.name))) {
        isTierActive = true;
      }

      const tierClass = tier.name.toLowerCase().includes("high") ? "tier-high" : (tier.name.toLowerCase().includes("low") ? "tier-low" : "tier-medium");

      tiersHtml += `
        <button class="submodel-pill ${tierClass} ${isTierActive ? "active" : ""}" onclick="selectModelTier('${tier.fullName}')">
          ${isTierActive ? "● " : ""}${tier.name}
        </button>
      `;
    });

    html += `
      <div class="model-family-card ${isFamilyActive ? "active-family" : ""}">
        <div class="model-family-header">
          <div class="model-family-title">
            <span>${fam.name}</span>
            <span class="brand-version" style="font-size:8.5px; padding:1px 4px;">${fam.tag}</span>
          </div>
        </div>
        <div class="model-family-desc">${fam.desc}</div>
        <div class="submodel-tiers-wrap">
          <span class="submodel-tier-label">Submodels:</span>
          ${tiersHtml}
        </div>
      </div>
    `;
  });
  return html;
}

function openModelModal() {
  haptic(20);
  if (!elements.modelModal || !elements.modelList) return;
  elements.modelList.innerHTML = generateModelFamiliesHtml();
  elements.modelModal.style.display = "flex";
}

function renderDrawerModelsTab() {
  if (!elements.drawerBody) return;
  elements.drawerBody.innerHTML = `
    <div style="padding: 10px 0;">
      <div style="font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 8px;">Select AI Model & Thinking Tier</div>
      ${generateModelFamiliesHtml()}
    </div>
  `;
}

window.selectModelTier = async function(modelFullName) {
  haptic(30);
  if (elements.modelModal) elements.modelModal.style.display = "none";
  state.activeModel = modelFullName;
  localStorage.setItem('ag_active_model', modelFullName);
  if (elements.modelLabel) elements.modelLabel.textContent = formatShortModelName(modelFullName);

  if (state.drawerActiveTab === "models") {
    renderDrawerModelsTab();
  }

  try {
    const res = await fetch("/api/models/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelFullName })
    });
    const data = await res.json();
    if (data.ok) {
      console.log(`[MODEL] Switched to ${modelFullName}`);
    }
  } catch (e) {}
};

// ----------------------------------------------------------------------
// History Modal
// ----------------------------------------------------------------------
async function openHistoryModal() {
  haptic(20);
  if (!elements.historyModal || !elements.historyList) return;
  elements.historyList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-tertiary);">Loading conversations...</div>';
  elements.historyModal.style.display = 'flex';

  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    const sessions = data.sessions || [];

    if (sessions.length === 0) {
      elements.historyList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-tertiary);">No past conversations found.</div>';
      return;
    }

    elements.historyList.innerHTML = '';
    sessions.forEach(s => {
      const item = document.createElement('div');
      item.className = `history-item ${s.active ? 'active-chat' : ''}`;
      item.onclick = () => selectHistoryChat(s.id, s.title, item);
      item.innerHTML = `
        <div style="flex:1; min-width:0; padding-right:10px;">
          <div class="history-item-title">${s.title}</div>
          <div class="history-item-subtitle">${s.subtitle || ''}</div>
        </div>
        <div class="history-item-status">
          ${s.active ? '<span class="history-badge active">Current</span>' : '<span class="history-badge switch">Open ➔</span>'}
        </div>
      `;
      elements.historyList.appendChild(item);
    });
  } catch (e) {
    elements.historyList.innerHTML = '<div style="color:var(--rose-glow); padding:20px; text-align:center;">Failed to load history.</div>';
  }
}

window.selectHistoryChat = async function(id, title, itemEl) {
  haptic(30);
  if (itemEl) {
    itemEl.style.opacity = '0.6';
    const badge = itemEl.querySelector('.history-badge');
    if (badge) badge.textContent = 'Switching...';
  }

  try {
    const res = await fetch('/api/select-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title })
    });
    const data = await res.json();
    if (data.ok) {
      if (elements.historyModal) elements.historyModal.style.display = 'none';
      renderMessages();
      haptic(40);
    } else {
      alert('Failed to switch conversation: ' + (data.error || 'Unknown error'));
      if (itemEl) itemEl.style.opacity = '1';
    }
  } catch (e) {
    alert('Error connecting to server: ' + e.message);
    if (itemEl) itemEl.style.opacity = '1';
  }
};

function initEventListeners() {
  if (elements.sendBtn) elements.sendBtn.addEventListener('click', sendMessage);
  
  if (elements.promptInput) {
    elements.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    elements.promptInput.addEventListener('input', () => {
      elements.promptInput.style.height = '32px';
      elements.promptInput.style.height = Math.min(elements.promptInput.scrollHeight, 120) + 'px';
    });
  }

  if (elements.stopBtn) {
    elements.stopBtn.addEventListener('click', async () => {
      haptic(35);
      await fetch('/api/stop', { method: 'POST' });
    });
  }

  if (elements.newChatBtn) {
    elements.newChatBtn.addEventListener('click', async () => {
      haptic(30);
      if (confirm('Start a fresh new chat session in Antigravity IDE?')) {
        await fetch('/api/new-chat', { method: 'POST' });
      }
    });
  }

  if (elements.syncBtn) {
    elements.syncBtn.addEventListener('click', syncChat);
  }

  if (elements.targetSwitchBtn) elements.targetSwitchBtn.addEventListener('click', toggleTarget);
  if (elements.autoAcceptBtn) elements.autoAcceptBtn.addEventListener('click', toggleAutoAccept);
  if (elements.brandBadge) elements.brandBadge.addEventListener('click', openDrawer);
  if (elements.modeSwitchBtn) elements.modeSwitchBtn.addEventListener('click', toggleAgentMode);
  if (elements.modelBtn) elements.modelBtn.addEventListener('click', openModelModal);
  if (elements.historyBtn) elements.historyBtn.addEventListener('click', openHistoryModal);
  if (elements.scrollToBottomBtn) elements.scrollToBottomBtn.addEventListener('click', scrollToBottom);
  if (elements.chatViewport) elements.chatViewport.addEventListener('scroll', handleScrollDetection);

  // Search Toggle
  if (elements.searchToggleBtn) {
    elements.searchToggleBtn.addEventListener('click', () => {
      haptic(15);
      const isVisible = elements.chatSearchBar.style.display !== 'none';
      elements.chatSearchBar.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) {
        elements.chatSearchInput.focus();
      } else {
        state.searchQuery = '';
        renderMessages();
      }
    });
  }

  if (elements.chatSearchInput) {
    elements.chatSearchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderMessages();
    });
  }

  if (elements.searchCloseBtn) {
    elements.searchCloseBtn.addEventListener('click', () => {
      elements.chatSearchBar.style.display = 'none';
      state.searchQuery = '';
      if (elements.chatSearchInput) elements.chatSearchInput.value = '';
      renderMessages();
    });
  }

  // Modals & Drawer Closes
  document.querySelectorAll('.sheet-close, .modal-overlay, .side-drawer-overlay').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target === el || el.classList.contains('sheet-close')) {
        if (elements.modelModal) elements.modelModal.style.display = 'none';
        if (elements.historyModal) elements.historyModal.style.display = 'none';
        if (elements.lensModal) elements.lensModal.style.display = 'none';
        closeDrawer();
      }
    });
  });

  // Attach button
  if (elements.attachBtn && elements.fileInput) {
    elements.attachBtn.addEventListener('click', () => {
      haptic(15);
      elements.fileInput.click();
    });

    elements.fileInput.addEventListener('change', async () => {
      const file = elements.fileInput.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.ok && data.file) {
          const tag = data.file.isImage ? `[Uploaded Image/Screenshot: ${data.file.path}]` : `[Attached File: ${data.file.path}]`;
          elements.promptInput.value = (elements.promptInput.value ? elements.promptInput.value + "\n\n" : "") + tag + "\n";
          elements.promptInput.focus();
          haptic(25);
        }
      } catch (e) {
        console.error('File upload failed:', e);
      } finally {
        elements.fileInput.value = '';
      }
    });
  }

  // Voice Dictation
  if (elements.micBtn && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    state.speechRecognition = new SpeechRecognition();
    state.speechRecognition.continuous = false;
    state.speechRecognition.interimResults = false;

    state.speechRecognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      elements.promptInput.value = (elements.promptInput.value + ' ' + transcript).trim();
      elements.micBtn.classList.remove('recording');
      state.isRecording = false;
    };

    state.speechRecognition.onerror = () => {
      elements.micBtn.classList.remove('recording');
      state.isRecording = false;
    };

    state.speechRecognition.onend = () => {
      elements.micBtn.classList.remove('recording');
      state.isRecording = false;
    };

    elements.micBtn.addEventListener('click', () => {
      haptic(25);
      if (state.isRecording) {
        state.speechRecognition.stop();
      } else {
        state.speechRecognition.start();
        elements.micBtn.classList.add('recording');
        state.isRecording = true;
      }
    });
  }
}

// ----------------------------------------------------------------------
// Application Startup
// ----------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  updateModeUI();
  connectWebSocket();
});


// ----------------------------------------------------------------------
// Bulletproof Mobile Resilience & Auto-Wake Re-Sync (Permafix)
// ----------------------------------------------------------------------
async function fetchAppState(forceRender = false) {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok) return;

    // 1. Sync Telemetry & Target
    if (data.stats) updateTelemetryUI(data.stats);

    // 2. Sync Agent State & Auto-dispatch queue
    if (data.agent) {
      const wasBusy = state.agent.busy;
      state.agent = data.agent;
      updateAgentUI();
      if (wasBusy && !state.agent.busy && state.messageQueue.length > 0) {
        dispatchQueuedMessage();
      }
    }

    // 3. Sync Action Prompts
    if (data.actions) {
      state.actions = data.actions;
      updateActionsUI(data.actions);
    }

    // 4. Sync Messages Stream
    if (Array.isArray(data.messages)) {
      const serverMsgs = data.messages;
      const clientCount = state.messages.length;
      const serverCount = serverMsgs.length;

      let hasChanged = forceRender || (clientCount !== serverCount);
      if (!hasChanged && clientCount > 0 && serverCount > 0) {
        const lastClient = state.messages[clientCount - 1];
        const lastServer = serverMsgs[serverCount - 1];
        if (lastClient.text !== lastServer.text || lastClient.from !== lastServer.from) {
          hasChanged = true;
        }
      }

      if (hasChanged) {
        state.messages = serverMsgs;
        renderMessages();
      }
    }
  } catch (e) {}
}

// Keep-alive heartbeat & visibility reconnection
function ensureLiveConnection() {
  if (!state.ws || state.ws.readyState === WebSocket.CLOSED || state.ws.readyState === WebSocket.CLOSING) {
    console.log('[PERMAFIX] Reconnecting WebSocket on wake...');
    connectWebSocket();
  } else if (state.ws.readyState === WebSocket.OPEN) {
    try {
      state.ws.send(JSON.stringify({ type: 'ping' }));
    } catch (e) {}
  }
  fetchAppState();
}

// Instant wake listener for mobile screen unlock & tab switching
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    ensureLiveConnection();
  }
});

window.addEventListener('focus', () => {
  ensureLiveConnection();
});

// Periodic background polling fallback (3 seconds)
setInterval(fetchAppState, 3000);


// ----------------------------------------------------------------------
// Agent Mode Engine (Fast vs Planning) - Clean SVG Icons
// ----------------------------------------------------------------------
window.updateModeUI = function() {
  const mode = state.agentMode || 'fast';
  const isFast = mode === 'fast';

  if (elements.modeLabel) elements.modeLabel.textContent = isFast ? 'Fast' : 'Plan';
  if (elements.modeIcon) {
    elements.modeIcon.innerHTML = isFast
      ? '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'
      : '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
  }

  if (elements.modeSwitchBtn) {
    elements.modeSwitchBtn.className = `header-pill-btn mode-pill ${mode}`;
  }

  const fastCard = document.getElementById('mode-card-fast');
  const planCard = document.getElementById('mode-card-plan');
  const fastDot = document.getElementById('mode-dot-fast');
  const planDot = document.getElementById('mode-dot-plan');

  if (fastCard && planCard) {
    fastCard.className = `mode-opt-card ${isFast ? 'active' : ''}`;
    planCard.className = `mode-opt-card ${!isFast ? 'active' : ''}`;
  }
  if (fastDot && planDot) {
    fastDot.textContent = isFast ? '●' : '○';
    planDot.textContent = !isFast ? '●' : '○';
  }
};

window.toggleAgentMode = function() {
  haptic(25);
  state.agentMode = state.agentMode === 'fast' ? 'plan' : 'fast';
  localStorage.setItem('ag_agent_mode', state.agentMode);
  window.updateModeUI();
};

window.selectAgentMode = function(mode) {
  haptic(25);
  state.agentMode = mode === 'plan' ? 'plan' : 'fast';
  localStorage.setItem('ag_agent_mode', state.agentMode);
  window.updateModeUI();
};



// ======================================================================
// لِسَان العَرَب - Lisan al-Arab Streaming Banner Engine
// ======================================================================
const LISAN_CONSONANT_MAP = {
  'ا': 'ā', 'أ': 'a', 'إ': 'i', 'آ': 'ā',
  'ب': 'b', 'ت': 't', 'ث': 'th',
  'ج': 'j', 'ح': 'ḥ', 'خ': 'kh',
  'د': 'd', 'ذ': 'dh',
  'ر': 'r', 'ز': 'z',
  'س': 's', 'ش': 'sh',
  'ص': 'ṣ', 'ض': 'ḍ',
  'ط': 'ṭ', 'ظ': 'ẓ',
  'ع': 'ʿ', 'غ': 'gh',
  'ف': 'f', 'ق': 'q',
  'ك': 'k', 'ل': 'l',
  'م': 'm', 'ن': 'n',
  'ه': 'h', 'و': 'w',
  'ي': 'y', 'ى': 'ā',
  'ء': 'ʾ', 'ة': 'h',
  'ـ': ''
};

const LISAN_DIACRITIC_MAP = {
  'َ': 'a',   // Fatha
  'ِ': 'i',   // Kasra
  'ُ': 'u',   // Damma
  'ً': 'an',  // Fathatan
  'ٍ': 'in',  // Kasratan
  'ٌ': 'un',  // Dammatan
  'ْ': '',    // Sukun
  'ّ': ''     // Shadda
};

function isArabicDiacritic(char) {
  return 'ًٌٍَُِّْ'.includes(char);
}

function transliterateArabicWord(word) {
  let result = '';
  const chars = [...word];

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (isArabicDiacritic(char)) continue;

    if (',.،؟:;'.includes(char)) {
      result += char;
      continue;
    }

    let latin = LISAN_CONSONANT_MAP[char];
    if (latin === undefined) {
      result += char;
      continue;
    }

    let j = i + 1;
    while (j < chars.length && isArabicDiacritic(chars[j])) {
      const diac = chars[j];
      if (diac === 'ّ') {
        latin = latin + latin;
      } else if (LISAN_DIACRITIC_MAP[diac]) {
        latin = latin + LISAN_DIACRITIC_MAP[diac];
      }
      j++;
    }

    result += latin;
  }
  return [...result].reverse().join('');
}

let lisanSentences = [
  "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
  "اقْرَأْ بِاسْمِ رَبِّكَ الَّذِي خَلَقَ",
  "خَلَقَ الْإِنسَانَ مِنْ عَلَقٍ",
  "اقْرَأْ وَرَبُّكَ الْأَكْرَمُ",
  "الَّذِي عَلَّمَ بِالْقَلَمِ",
  "عَلَّمَ الْإِنسَانَ مَا لَمْ يَعْلَمْ"
];

let currentLisanIndex = 0;
let isLisanInitialized = false;
let lisanCurrentScroll = 0;
const LISAN_SCROLL_SPEED = 32;
let lisanLastTime = performance.now();

function createLisanWordBlock(arabic, latin) {
  const block = document.createElement('div');
  block.className = 'word-block';
  block.dataset.type = 'word';

  const arSpan = document.createElement('div');
  arSpan.className = 'word-arabic';
  arSpan.textContent = arabic;

  const laSpan = document.createElement('div');
  laSpan.className = 'word-latin';
  laSpan.textContent = latin;

  block.appendChild(arSpan);
  block.appendChild(laSpan);
  return block;
}

function createLisanSeparator() {
  const sep = document.createElement('div');
  sep.className = 'lisan-separator';
  sep.dataset.type = 'separator';
  sep.textContent = '◆';
  return sep;
}

function createLisanSentenceFragment(sentence) {
  const words = sentence.split(' ').reverse();
  const fragment = document.createDocumentFragment();
  fragment.appendChild(createLisanSeparator());

  words.forEach(word => {
    if (!word.trim()) return;
    const latin = transliterateArabicWord(word);
    fragment.appendChild(createLisanWordBlock(word, latin));
  });
  return fragment;
}

function prependNextLisanSentence(marquee) {
  if (!lisanSentences.length || !marquee) return;
  const sentence = lisanSentences[currentLisanIndex];
  const fragment = createLisanSentenceFragment(sentence);

  const oldRect = marquee.getBoundingClientRect();
  const oldWidth = oldRect.width;

  if (marquee.firstChild) {
    marquee.insertBefore(fragment, marquee.firstChild);
  } else {
    marquee.appendChild(fragment);
  }

  const newRect = marquee.getBoundingClientRect();
  const addedWidth = newRect.width - oldWidth;
  lisanCurrentScroll -= addedWidth;
  currentLisanIndex = (currentLisanIndex + 1) % lisanSentences.length;
}

function animateLisanStream(currentTime) {
  const marquee = document.getElementById('lisan-marquee');
  if (!marquee) return;

  const deltaTime = (currentTime - lisanLastTime) / 1000;
  const dt = Math.min(deltaTime, 0.1);
  lisanLastTime = currentTime;

  lisanCurrentScroll += LISAN_SCROLL_SPEED * dt;

  if (lisanCurrentScroll > -200) {
    prependNextLisanSentence(marquee);
  }

  const parent = marquee.parentElement;
  if (parent) {
    const viewportWidth = parent.offsetWidth;
    const lastChild = marquee.lastElementChild;
    if (lastChild) {
      const visualLeft = lastChild.offsetLeft + lisanCurrentScroll;
      if (visualLeft > viewportWidth) {
        marquee.removeChild(lastChild);
      }
    }
  }

  marquee.style.transform = `translate3d(${lisanCurrentScroll}px, 0, 0)`;
  requestAnimationFrame(animateLisanStream);
}

function initLisanBanner() {
  const marquee = document.getElementById('lisan-marquee');
  if (!marquee || isLisanInitialized) return;
  isLisanInitialized = true;
  marquee.style.direction = 'ltr';

  while (marquee.getBoundingClientRect().width < window.innerWidth * 2) {
    prependNextLisanSentence(marquee);
  }

  const width = marquee.getBoundingClientRect().width;
  lisanCurrentScroll = -width + window.innerWidth;
  lisanLastTime = performance.now();
  requestAnimationFrame(animateLisanStream);
}

async function fetchLisanData() {
  try {
    const res = await fetch('/api/lisan');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        lisanSentences = data;
        currentLisanIndex = 0;
        if (!isLisanInitialized) {
          initLisanBanner();
        }
      }
    }
  } catch (e) {
    console.error('Failed to fetch Lisan data:', e);
  }
}

// Auto-start Lisan stream & Click to Dismiss

window.dismissLisanBanner = function() {
  haptic(25);
  const banner = document.getElementById('lisanBanners');
  if (banner) {
    banner.classList.add('collapsed');
    banner.classList.add('hidden');
    localStorage.setItem('ag_lisan_collapsed', 'true');
  }
};

window.toggleLisanBanner = function() {
  haptic(25);
  const banner = document.getElementById('lisanBanners');
  if (!banner) return;
  const isHidden = banner.classList.contains('hidden') || banner.classList.contains('collapsed');
  if (isHidden) {
    banner.classList.remove('hidden');
    banner.classList.remove('collapsed');
    localStorage.setItem('ag_lisan_collapsed', 'false');
    if (!isLisanInitialized) {
      initLisanBanner();
    }
  } else {
    banner.classList.add('hidden');
    banner.classList.add('collapsed');
    localStorage.setItem('ag_lisan_collapsed', 'true');
  }
  if (state.drawerActiveTab === 'themes') {
    renderThemesTab();
  }
};

function setupLisanBannerEvents() {
  const banner = document.getElementById('lisanBanners');
  if (banner) {
    banner.onclick = () => {
      window.dismissLisanBanner();
    };
    if (localStorage.getItem('ag_lisan_collapsed') === 'true') {
      banner.classList.add('hidden');
      banner.classList.add('collapsed');
    }
  }
}


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupLisanBannerEvents();
    fetchLisanData();
    setInterval(fetchLisanData, 60000);
  });
} else {
  setupLisanBannerEvents();
  fetchLisanData();
  setInterval(fetchLisanData, 60000);
  setupChatContentInteractions();
  loadSnapshot();
}


// ----------------------------------------------------------------------
// GravityRemote2 High-Fidelity Snapshot, Command Box & File Engine (v3.8)
// ----------------------------------------------------------------------

let userScrollLockUntil = 0;
let lastSnapshotHash = null;
let currentFileViewerRawContent = '';

async function loadSnapshot() {
  const chatContent = elements.chatContent || document.getElementById('chatContent');
  const chatViewport = elements.chatViewport || document.getElementById('chat-viewport');
  if (!chatContent || !chatViewport) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('/api/snapshot', { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      if (res.status === 503 && (!chatContent.innerHTML || chatContent.innerHTML.includes('Connecting'))) {
        chatContent.innerHTML = `
          <div class="loading-state">
            <div class="loading-spinner"></div>
            <p style="color:#a1a1aa; font-size:13px; font-weight:500;">Connecting to Antigravity IDE Workbench...</p>
          </div>
        `;
      }
      return;
    }

    const data = await res.json();
    if (data.isAgentBusy !== undefined) {
      state.agent.busy = data.isAgentBusy;
      updateAgentUI();
    }

    // Capture scroll state BEFORE updating content
    const scrollPos = chatViewport.scrollTop;
    const scrollHeight = chatViewport.scrollHeight;
    const clientHeight = chatViewport.clientHeight;
    const isNearBottom = (scrollHeight - scrollPos - clientHeight) < 140;
    const isUserScrollLocked = Date.now() < userScrollLockUntil;

    // Dynamic Style Injection with Dark Mode Overrides
    let styleTag = document.getElementById('cdp-styles');
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'cdp-styles';
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = (data.css || '') + '\n';

    // Update DOM if hash changed or first load
    if (data.hash !== lastSnapshotHash || !lastSnapshotHash) {
      lastSnapshotHash = data.hash;
      chatContent.innerHTML = data.html;
      addMobileCopyButtons();
    }

    // Smart scroll management
    if (isUserScrollLocked) {
      const scrollPercent = scrollHeight > 0 ? scrollPos / scrollHeight : 0;
      chatViewport.scrollTop = chatViewport.scrollHeight * scrollPercent;
    } else if (isNearBottom || scrollPos === 0) {
      chatViewport.scrollTop = chatViewport.scrollHeight;
    }

    // Floating scroll-to-bottom button
    if (elements.scrollToBottomBtn) {
      const distance = chatViewport.scrollHeight - chatViewport.scrollTop - chatViewport.clientHeight;
      if (distance > 160) {
        elements.scrollToBottomBtn.classList.add('show');
      } else {
        elements.scrollToBottomBtn.classList.remove('show');
      }
    }
  } catch(e) {
    // Retain current view gracefully on transient network errors
  }
}

function burstLoadSnapshot() {
  setTimeout(loadSnapshot, 200);
  setTimeout(loadSnapshot, 600);
  setTimeout(loadSnapshot, 1500);
  setTimeout(loadSnapshot, 3000);
  setTimeout(loadSnapshot, 6000);
}

function appendOptimisticUserBubble(text) {
  const chatContent = elements.chatContent || document.getElementById('chatContent');
  const chatViewport = elements.chatViewport || document.getElementById('chat-viewport');
  if (!chatContent || !chatViewport) return;

  const bubble = document.createElement('div');
  bubble.className = 'optimistic-user-bubble';
  bubble.textContent = text;
  chatContent.appendChild(bubble);
  chatViewport.scrollTop = chatViewport.scrollHeight;
}

function addMobileCopyButtons() {
  const chatContent = elements.chatContent || document.getElementById('chatContent');
  if (!chatContent) return;

  const codeBlocks = chatContent.querySelectorAll('pre');
  codeBlocks.forEach(pre => {
    if (pre.querySelector('.mobile-copy-btn')) return;
    pre.classList.add('has-copy-btn');

    const btn = document.createElement('button');
    btn.className = 'mobile-copy-btn';
    btn.setAttribute('aria-label', 'Copy code');
    btn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

    btn.onclick = (e) => {
      e.stopPropagation();
      const code = pre.querySelector('code')?.innerText || pre.innerText;
      navigator.clipboard.writeText(code).then(() => {
        btn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`;
        btn.style.color = '#22c55e';
        haptic(20);
        setTimeout(() => {
          btn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
          btn.style.color = '';
        }, 2000);
      });
    };
    pre.appendChild(btn);
  });
}

function setupChatContentInteractions() {
  const chatContent = elements.chatContent || document.getElementById('chatContent');
  const chatViewport = elements.chatViewport || document.getElementById('chat-viewport');
  if (!chatContent || !chatViewport) return;

  // Track user scroll locks
  chatViewport.addEventListener('scroll', () => {
    const scrollPos = chatViewport.scrollTop;
    const scrollHeight = chatViewport.scrollHeight;
    const clientHeight = chatViewport.clientHeight;
    const isNearBottom = (scrollHeight - scrollPos - clientHeight) < 140;

    if (!isNearBottom) {
      userScrollLockUntil = Date.now() + 10000;
      if (elements.scrollToBottomBtn) elements.scrollToBottomBtn.classList.add('show');
    } else {
      userScrollLockUntil = 0;
      if (elements.scrollToBottomBtn) elements.scrollToBottomBtn.classList.remove('show');
    }
  }, { passive: true });

  // Floating scroll-to-bottom button action
  if (elements.scrollToBottomBtn) {
    elements.scrollToBottomBtn.onclick = () => {
      haptic(15);
      userScrollLockUntil = 0;
      chatViewport.scrollTo({ top: chatViewport.scrollHeight, behavior: 'smooth' });
    };
  }

  // Delegated clicks inside live IDE chat
  chatContent.addEventListener('click', async (e) => {
    // 1. Anchor links (file preview / markdown / download)
    const anchor = e.target.closest('a');
    if (anchor) {
      const href = anchor.getAttribute('href') || '';
      if (href.includes('/api/file/raw') || href.includes('/api/file/download') || href.startsWith('file://') || href.match(/\.(md|markdown|txt|js|ts|py|json|sh|log|pdf|png|jpg)(\?|#|$)/i)) {
        e.preventDefault();
        e.stopPropagation();
        let targetPath = href;
        try {
          const urlParams = new URL(href, window.location.origin);
          targetPath = urlParams.searchParams.get('path') || href;
        } catch(uErr) {}
        openMobileFileViewer(targetPath);
        return;
      }
    }

    // 2. Artifact cards (green pills / artifact widgets / walkthrough & plan cards)
    const cardEl = e.target.closest('.artifact-card, [data-testid*="artifact"], .file-card, div:has(> button[draggable="true"]), button[draggable="true"]');
    if (cardEl && !e.target.closest('pre, code, .mobile-copy-btn')) {
      const titleEl = cardEl.querySelector('button, [data-testid*="title"], h1, h2, h3, h4, span, div');
      const fullText = (cardEl.getAttribute('data-path') || cardEl.getAttribute('data-filename') || (titleEl ? titleEl.innerText : cardEl.innerText) || '').trim();
      
      let targetFile = null;
      if (/walkthrough/i.test(fullText)) {
        targetFile = 'walkthrough.md';
      } else if (/implementation\s*plan/i.test(fullText)) {
        targetFile = 'implementation_plan.md';
      } else if (/task\s*list/i.test(fullText)) {
        targetFile = 'task.md';
      } else {
        const match = fullText.match(/([a-zA-Z0-9_\-\.\/]+\.(md|markdown|js|ts|jsx|tsx|py|json|html|css|sh|txt|png|jpg|jpeg|svg|webp|log|pdf))/i);
        if (match && match[1] && match[1].length >= 4 && !match[1].startsWith('http:') && !match[1].startsWith('https:')) {
          targetFile = match[1];
        }
      }

      if (targetFile) {
        e.preventDefault();
        e.stopPropagation();
        haptic(25);
        openMobileFileViewer(targetFile);

        // Also trigger remote click in background if there is a remoteId so desktop IDE also opens the artifact tab
        const remoteBtn = cardEl.querySelector('[data-remote-id]') || cardEl.closest('[data-remote-id]');
        if (remoteBtn) {
          const rid = remoteBtn.getAttribute('data-remote-id');
          fetch('/api/remote-click', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ remoteId: rid })
          }).catch(() => {});
        }
        return;
      }
    }

    // 3. Collapsible tool steps & thoughts (Thought for..., Worked for..., Ran command...)
    const thoughtBtn = e.target.closest('button, div.relative > button, div[role="button"]');
    const workedForBtn = e.target.closest('button[data-testid="worked-for-collapsible"], button[class*="tabular-nums"]');
    const toolRow = e.target.closest('div.group.cursor-pointer, div[role="button"]');

    let targetEl = workedForBtn || thoughtBtn || toolRow;
    if (!targetEl) {
      const candidate = e.target.closest('div, span, p, button');
      if (candidate) {
        const txt = (candidate.innerText || candidate.textContent || '').trim();
        if (/^(Thought|Thinking|Worked for|Ran\b|Explored\b|Running\b)/i.test(txt)) {
          targetEl = candidate;
        }
      }
    }

    if (!targetEl) return;

    const rawText = (targetEl.innerText || targetEl.textContent || '').trim();
    const firstLine = rawText.split('\n')[0].trim();
    const testId = targetEl.getAttribute('data-testid') || (targetEl.querySelector('[data-testid]')?.getAttribute('data-testid')) || '';
    const ariaLabel = targetEl.getAttribute('aria-label') || '';
    const tagName = targetEl.tagName.toLowerCase();

    const isThought = /Thought|Thinking/i.test(firstLine);
    const isWorkedFor = /Worked for/i.test(firstLine) || testId === 'worked-for-collapsible';
    const isTool = /^(Ran|Explored|Running|Run)\b/i.test(firstLine);

    // Check if target or parent has a stamped remote ID
    const remoteId = targetEl.getAttribute('data-remote-id') || 
                     targetEl.closest('[data-remote-id]')?.getAttribute('data-remote-id') || 
                     targetEl.querySelector('[data-remote-id]')?.getAttribute('data-remote-id') || 
                     undefined;

    if (!isThought && !isWorkedFor && !isTool && !testId && !remoteId) return;

    e.preventDefault();
    e.stopPropagation();

    haptic(20);
    targetEl.style.opacity = '0.6';
    targetEl.style.transform = 'scale(0.98)';
    setTimeout(() => {
      targetEl.style.opacity = '1';
      targetEl.style.transform = '';
    }, 180);

    // Optimistic toggle of aria-expanded state for instant UI response
    const curExp = targetEl.getAttribute('aria-expanded');
    if (curExp === 'false') {
      targetEl.setAttribute('aria-expanded', 'true');
    } else if (curExp === 'true') {
      targetEl.setAttribute('aria-expanded', 'false');
    }

    let matchIndex = 0;
    try {
      const allMatching = Array.from(chatContent.querySelectorAll(tagName))
        .filter(el => {
          const t = (el.innerText || el.textContent || '').trim().split('\n')[0].trim();
          return t && (t === firstLine || t.includes(firstLine) || firstLine.includes(t));
        });
      const idx = allMatching.indexOf(targetEl);
      if (idx >= 0) matchIndex = idx;
    } catch(e) {}

    try {
      await fetch('/api/remote-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remoteId,
          testId: testId || undefined,
          ariaLabel: ariaLabel || undefined,
          tagName,
          textContent: firstLine,
          index: matchIndex
        })
      });

      setTimeout(loadSnapshot, 120);
      setTimeout(loadSnapshot, 350);
      setTimeout(loadSnapshot, 750);
      setTimeout(loadSnapshot, 1400);
    } catch(err) {
      console.warn('[Remote Click Error]:', err);
    }
  });
}

// ----------------------------------------------------------------------
// Sovereign Mobile File Viewer Logic
// ----------------------------------------------------------------------

window.openMobileFileViewer = async function(filePath) {
  if (!filePath) return;
  const overlay = elements.fileViewerOverlay || document.getElementById('fileViewerOverlay');
  const filenameEl = elements.fileViewerFilename || document.getElementById('fileViewerFilename');
  const sizeBadge = elements.fileViewerSizeBadge || document.getElementById('fileViewerSizeBadge');
  const typeBadge = elements.fileViewerTypeBadge || document.getElementById('fileViewerTypeBadge');
  const pathPreview = elements.fileViewerPathPreview || document.getElementById('fileViewerPathPreview');
  const bodyEl = elements.fileViewerBody || document.getElementById('fileViewerBody');
  const downloadBtn = elements.fileDownloadBtn || document.getElementById('fileDownloadBtn');
  const rawBtn = elements.fileRawBtn || document.getElementById('fileRawBtn');

  if (!overlay || !bodyEl) return;

  const cleanName = filePath.split('/').pop().split('#')[0] || 'Document';
  if (filenameEl) filenameEl.textContent = cleanName;
  if (sizeBadge) sizeBadge.textContent = 'Loading...';
  if (pathPreview) pathPreview.textContent = filePath;
  bodyEl.innerHTML = `
    <div class="file-viewer-loading">
      <div class="loading-spinner"></div>
      <p style="color:#a1a1aa; font-size:12px;">Loading ${escapeHtml(cleanName)}...</p>
    </div>
  `;

  overlay.classList.add('show');
  haptic(15);

  try {
    const res = await fetch(`/api/file/view?path=${encodeURIComponent(filePath)}`);
    const data = await res.json();

    if (!data.ok || !data.success) {
      bodyEl.innerHTML = `
        <div class="file-viewer-loading" style="color:#f87171;">
          <div style="font-size:14px;color:#ef4444;font-weight:700;">Could not open file</div>
          <p style="font-size:12px;color:#94a3b8;margin-top:4px;">${escapeHtml(data.error || 'Unknown error')}</p>
        </div>
      `;
      return;
    }

    currentFileViewerRawContent = data.content || '';
    if (filenameEl) filenameEl.textContent = data.name;
    if (sizeBadge) sizeBadge.textContent = formatBytes(data.size);
    if (pathPreview) pathPreview.textContent = data.path;

    if (downloadBtn) downloadBtn.href = `/api/file/download?path=${encodeURIComponent(data.path)}`;
    if (rawBtn) rawBtn.href = `/api/file/raw?path=${encodeURIComponent(data.path)}`;

    const ext = data.name.split('.').pop().toLowerCase();
    if (typeBadge) typeBadge.textContent = ext.toUpperCase();

    if (data.isImage) {
      bodyEl.innerHTML = `
        <div style="text-align:center;padding:12px 0;">
          <img src="${data.dataUrl}" alt="${data.name}" style="max-width:100%; border-radius:8px; border:1px solid #333;" />
        </div>
      `;
    } else if (data.isMarkdown) {
      bodyEl.innerHTML = renderMarkdown(data.content);
    } else {
      bodyEl.innerHTML = `<pre><code>${escapeHtml(data.content)}</code></pre>`;
    }
  } catch(e) {
    bodyEl.innerHTML = `<div class="file-viewer-loading" style="color:#f87171;">Load Error: ${e.message}</div>`;
  }
};

window.closeMobileFileViewer = function() {
  const overlay = elements.fileViewerOverlay || document.getElementById('fileViewerOverlay');
  if (overlay) {
    overlay.classList.remove('show');
    haptic(15);
  }
};

window.handleFileOverlayClick = function(e) {
  const overlay = elements.fileViewerOverlay || document.getElementById('fileViewerOverlay');
  if (e.target === overlay) {
    closeMobileFileViewer();
  }
};

window.copyFileViewerContent = function() {
  if (!currentFileViewerRawContent) return;
  navigator.clipboard.writeText(currentFileViewerRawContent).then(() => {
    haptic(25);
    const copyBtn = elements.fileCopyBtn || document.getElementById('fileCopyBtn');
    if (copyBtn) {
      const original = copyBtn.innerHTML;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.innerHTML = original; }, 2000);
    }
  });
};

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
