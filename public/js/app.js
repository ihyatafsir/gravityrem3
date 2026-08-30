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
  currentTheme: localStorage.getItem('ag_theme') || 'matrix',
  searchQuery: '',
  visibleLimit: 80
};

function formatShortModelName(name) {
  if (!name) return "Gemini 3.7 (High)";
  let short = "Gemini 3.7";
  if (name.includes("3.7")) short = "Gemini 3.7";
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
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    tag: "Flagship",
    desc: "Google flagship hybrid reasoning & rapid coding",
    tiers: [
      { id: "gemini-3.7-flash-medium", name: "Medium", fullName: "Gemini 3.7 Flash Medium", desc: "Balanced reasoning & speed" }
    ]
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    tag: "Fast",
    desc: "Balanced rapid agentic workflows & tool execution",
    tiers: [
      { id: "gemini-3.6-flash-medium", name: "Medium", fullName: "Gemini 3.6 Flash Medium", desc: "Standard medium tier" }
    ]
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    tag: "Light",
    desc: "Lightweight high-efficiency model",
    tiers: [
      { id: "gemini-3.5-flash-medium", name: "Medium", fullName: "Gemini 3.5 Flash Medium", desc: "Balanced medium tier" }
    ]
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    tag: "Deep",
    desc: "Deep multi-step reasoning & planning",
    tiers: [
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

