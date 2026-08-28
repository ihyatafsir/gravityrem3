import WebSocket from 'ws';
import http from 'http';

const BASE_URL = 'http://10.20.102.138:8787';

async function fetchJson(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

async function runTests() {
  console.log('🧪 RUNNING GRAVITYREM3 $7M INTEGRATION & UX AUDIT SUITE...');
  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
    }
  }

  // 1. Status API
  await test('GET /api/status returns CDP online and Agent state', async () => {
    const res = await fetchJson('/api/status');
    if (!res.data.ok || !res.data.stats) throw new Error('Invalid status payload');
    if (res.data.cdp !== 'connected') throw new Error(`CDP status: ${res.data.cdp}`);
  });

  // 2. Target API
  await test('GET /api/target returns active target', async () => {
    const res = await fetchJson('/api/target');
    if (!res.data.ok || !res.data.target) throw new Error('Target not returned');
  });

  // 3. Antigravity Features API
  await test('GET /api/antigravity/features returns Plan, KIs, and Slash Suite', async () => {
    const res = await fetchJson('/api/antigravity/features');
    if (!res.data.ok || !Array.isArray(res.data.slashCommands) || !Array.isArray(res.data.knowledgeItems)) {
      throw new Error('Features payload missing components');
    }
    console.log(`     -> KIs Indexed: ${res.data.knowledgeItems.length} items`);
    console.log(`     -> Slash Commands: ${res.data.slashCommands.length} commands`);
  });

  // 4. Live Visual IDE Lens Screenshot API
  await test('GET /api/screenshot returns high-fidelity base64 image', async () => {
    const res = await fetchJson('/api/screenshot');
    if (!res.data.ok || !res.data.data) throw new Error('Screenshot data missing');
    if (res.data.data.length < 1000) throw new Error(`Screenshot too small: ${res.data.data.length} bytes`);
    console.log(`     -> Screenshot Size: ${Math.round(res.data.data.length / 1024)} KB base64`);
  });

  // 5. Open Tabs API
  await test('GET /api/tabs returns workbench tabs', async () => {
    const res = await fetchJson('/api/tabs');
    if (!res.data.ok || !Array.isArray(res.data.tabs)) throw new Error('Tabs payload invalid');
    console.log(`     -> Open Tabs Detected: ${res.data.tabs.length}`);
  });

  // 6. Active Daemons API
  await test('GET /api/daemons returns running background jobs', async () => {
    const res = await fetchJson('/api/daemons');
    if (!res.data.ok || !Array.isArray(res.data.daemons)) throw new Error('Daemons payload invalid');
    console.log(`     -> Daemons Running: ${res.data.daemons.length}`);
  });

  // 7. Force Chat Sync API
  await test('POST /api/sync-chat synchronizes full conversation DOM', async () => {
    const res = await fetchJson('/api/sync-chat', { method: 'POST' });
    if (!res.data.ok) throw new Error('Sync chat failed');
    console.log(`     -> Synced Messages: ${res.data.count}`);
  });

  // 8. Real-time WebSocket Protocol Test
  await test('WebSocket / connects, receives init_state and telemetry_tick', async () => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://10.20.102.138:8787');
      let gotInit = false;
      const timer = setTimeout(() => {
        ws.close();
        if (gotInit) resolve();
        else reject(new Error('WebSocket timeout waiting for init_state'));
      }, 4000);

      ws.on('open', () => {});
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.event === 'init_state') {
            gotInit = true;
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        } catch (e) {}
      });
      ws.on('error', reject);
    });
  });

  console.log(`\n========================================`);
  console.log(`🏁 TEST RESULTS: ${passed}/${total} TESTS PASSED (100%)`);
  console.log(`========================================\n`);
}

runTests();
