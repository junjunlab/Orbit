// CDP test: 轨道标签列（第二列）可以左右拖动改宽度，宽度会记住，双击复位。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.env.IGV_TEST_PORT || '8799';
const URL = `http://127.0.0.1:${PORT}/?db=hg38&locus=chr1:26100000-26120000`;

async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const t = list.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const w = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (m, p) => new Promise((res) => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) { console.error('JS ERR', JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return null; }
    return r.result.result.value;
  };
  const waitBoot = async () => {
    for (let i = 0; i < 120; i++) {
      if (await ev('!!(window.__igv && window.__igv.S.asm)')) return true;
      await sleep(250);
    }
    return false;
  };
  const geo = () => ev(`(() => {
    const v = document.querySelector('#view');
    const r = v.getBoundingClientRect();
    const cv = document.querySelector('.track[data-track="ruler"] .track-body canvas');
    return JSON.stringify({ left: Math.round(r.left), labelW: window.__igv.S.labelW,
      cssVar: getComputedStyle(v).getPropertyValue('--label-w').trim(),
      canvasW: cv ? Math.round(cv.getBoundingClientRect().width) : null });
  })()`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await waitBoot();
  await sleep(1200);

  const before = JSON.parse(await geo());

  // 拖动分隔条：96 -> 220（真实鼠标事件）
  const x0 = before.left + before.labelW;
  const y = 200;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y, button: 'none' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', clickCount: 1 });
  for (let dx = 10; dx <= 124; dx += 12) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + dx, y, button: 'left' });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + 124, y, button: 'left', clickCount: 1 });
  await sleep(700);
  const afterDrag = JSON.parse(await geo());

  // 刷新后应保留
  await send('Page.reload', { ignoreCache: true });
  await waitBoot();
  await sleep(1000);
  const afterReload = JSON.parse(await geo());

  // 双击复位
  await ev(`(() => {
    const v = document.querySelector('#view');
    const r = v.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + window.__igv.S.labelW, 200);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + window.__igv.S.labelW, clientY: 200 }));
  })()`);
  await sleep(600);
  const afterDbl = JSON.parse(await geo());

  console.log('before       ', JSON.stringify(before));
  console.log('after drag   ', JSON.stringify(afterDrag));
  console.log('after reload ', JSON.stringify(afterReload));
  console.log('after dblclk ', JSON.stringify(afterDbl));

  const pass = before.labelW === 116
    && afterDrag.labelW >= 220 && afterDrag.labelW <= 250
    && afterDrag.canvasW < before.canvasW
    // igv_0.2 起「每次启动/刷新都从零开始」：刷新后列宽回到默认 116（P1-3）
    && afterReload.labelW === 116
    && afterDbl.labelW === 116;
  console.log(pass ? 'RESULT PASS' : 'RESULT FAIL');

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync('tools/_label_w.png', Buffer.from(shot.result.data, 'base64'));
  ws.close();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
