# GravityRem3 — Flagship Remote Suite for Antigravity IDE

**GravityRem3** is an agentic remote control suite for the **Antigravity IDE** powered by the Chrome DevTools Protocol (CDP). It allows real-time remote monitoring, workspace navigation, agent steering, prompt submission, action button approval, and model switching over WebSockets and REST.

---

## Features

- ⚡ **Real-Time Agent Stream**: Live terminal output, agent thought processes, and plan generation streaming.
- 🎯 **Action Approval & Control**: One-click permission prompt approvals, Auto-Accept toggles, and task interruption.
- 🎛️ **Dynamic Model Switcher**: Hot-swap active AI models (Gemini 3.8 Flash, Gemini 3.7 Flash, Claude Sonnet 4.6 Thinking, Opus 4.6, GPT-OSS 120B, etc.) on the fly.
- 🖥️ **Dedicated Remote AI Workstation**: Designed to run directly alongside Antigravity IDE in headless or Wayland/X11 virtual display environments.
- 🛡️ **Zero Interference CDP Target Resolution**: Automatically filters non-IDE tabs and worker threads to lock exclusively onto the Antigravity IDE workbench (`workbench.html`).
- 🔄 **Self-Healing Systemd Integration**: Fully persistent systemd user services with auto-restart and linger support.

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Launch Antigravity IDE with Remote Debugging
```bash
antigravity --remote-debugging-port=9222 --no-sandbox
```

### 3. Start GravityRem3 Server
```bash
# Default port: 8787, Target: VM (Port 9222)
npm start
```
Access the remote suite in your browser at `http://<HOST_IP>:8787/`.

---

## Systemd Services (Autonomous Remote VM)

### Antigravity IDE (`~/.config/systemd/user/antigravity-ide.service`)
```ini
[Unit]
Description=Antigravity IDE - Remote AI Workstation
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/grem3/gravityrem3
ExecStart=/home/grem3/gravityrem3/scripts/start_ide.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

### GravityRem3 (`~/.config/systemd/user/gravityrem3.service`)
```ini
[Unit]
Description=GravityRem3 - Flagship Remote Suite for Antigravity IDE
After=network.target antigravity-ide.service
Wants=antigravity-ide.service

[Service]
Type=simple
WorkingDirectory=/home/grem3/gravityrem3
ExecStart=/home/grem3/gravityrem3/scripts/start_server.sh
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

Enable user lingering so services persist across sessions:
```bash
loginctl enable-linger <user>
systemctl --user daemon-reload
systemctl --user enable --now antigravity-ide.service gravityrem3.service
```

---

## Architecture & API

- **Web UI & WebSocket**: Port `8787`
- **CDP Local Endpoint**: Port `9222` (`127.0.0.1:9222`)
- **Key API Routes**:
  - `GET /api/status` — Live status, CDP connection state, active agent state, system metrics
  - `GET /api/stats` — CPU, RAM, uptime, and connected clients
  - `GET /api/models` — Available AI models and active model
  - `POST /api/messages` — Send user prompts to the agent
  - `POST /api/stop` — Cancel running generation
  - `POST /api/auto-accept/toggle` — Toggle Auto Accept
  - `POST /api/plan/approve` — Approve pending execution plans
  - `GET /api/screenshot` — Capture current IDE screenshot

---

## License

MIT License.
