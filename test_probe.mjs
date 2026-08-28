import WebSocket from 'ws';
import http from 'http';

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const targets = JSON.parse(body);
    console.log('=== VM CDP TARGETS ===');
    console.log(targets.map(t => ({ id: t.id, title: t.title, type: t.type, url: t.url })));

    let target = targets.find(t => t.url && t.url.includes('workbench.html')) || targets[0];
    if (!target || !target.webSocketDebuggerUrl) {
      console.log('No debugger target found');
      return;
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.on('open', async () => {
      let id = 1;
      const send = (method, params={}) => new Promise((resolve) => {
        const curId = id++;
        const h = (raw) => {
          const m = JSON.parse(raw);
          if (m.id === curId) {
            ws.off('message', h);
            resolve(m.result);
          }
        };
        ws.on('message', h);
        ws.send(JSON.stringify({ id: curId, method, params }));
      });

      await send('Runtime.enable');
      await send('DOM.enable');

      const evalRes = await send('Runtime.evaluate', {
        expression: `(() => {
          const text = document.body.innerText || '';
          const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable]')).map(i => ({
            tag: i.tagName,
            placeholder: i.placeholder,
            className: i.className
          }));
          return {
            title: document.title,
            textLen: text.length,
            preview: text.slice(0, 500),
            inputs: inputs
          };
        })()`,
        returnByValue: true
      });

      console.log('=== DOM EVAL ===', JSON.stringify(evalRes, null, 2));
      process.exit(0);
    });
  });
});
