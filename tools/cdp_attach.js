// 连到「已经开着的」CDP 调试端口（而不是自己拉一个 Chrome）：
//   node tools/cdp_attach.js <port> <out.png> [jsExpr]
//
// 用途：验证原生窗口（WebView2 / WKWebView）里页面到底渲染成什么样。
// WebView2 需要先设 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333
const fs = require('fs');

const port = process.argv[2] || '9333';
const out = process.argv[3];
const expr = process.argv[4];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = list.find((t) => t.type === 'page' && !/^(devtools|about:blank)/.test(t.url || ''));
  if (!target) {
    console.error('no page target:', JSON.stringify(list.map((t) => [t.type, t.url])));
    process.exit(1);
  }
  console.log('target:', target.url, '|', target.title);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; waiting.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Page.enable', {});
  await send('Runtime.enable', {});

  if (expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const det = r.result && r.result.exceptionDetails;
    console.log('JS ->', det ? 'ERROR ' + JSON.stringify(det).slice(0, 400)
      : JSON.stringify(r.result && r.result.result && r.result.result.value));
    await sleep(600);
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (!shot.result || !shot.result.data) {
    console.error('screenshot failed', JSON.stringify(shot).slice(0, 300));
    process.exit(1);
  }
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('wrote', out, Buffer.from(shot.result.data, 'base64').length, 'bytes');
  ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
