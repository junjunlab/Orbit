// CDP test: BAM 的比对视图（reads 堆叠）是否渲染出来。
// 依赖 dist/Orbit/data/loaded/chr1_output.bam（4.1M reads，全在 chr1）。
// 用法：先起开发服务器（8799，IGV_RESTORE_LOADED=1）和无头 Chrome（9222），再 node 本脚本。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.env.IGV_TEST_PORT || '8799';
const URL = `http://127.0.0.1:${PORT}/?db=hg38&locus=chr1:7670000-7680000`;
const TID = 'chr1_output';

async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const t = list.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const w = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params) => new Promise((res) => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      console.error('JS ERR', JSON.stringify(r.result.exceptionDetails).slice(0, 600));
      return null;
    }
    return r.result.result.value;
  };

  const errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });

  // 等 BAM 轨道与比对数据就绪
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const v = await ev(`(() => {
      const S = window.__igv && window.__igv.S;
      if (!S) return 'no-state';
      const P = S.panels[S.act];
      const d = P.alignData && P.alignData[${JSON.stringify(TID)}];
      if (!d) return 'no-data';
      return d.reads ? 'ok' : 'pending';
    })()`);
    if (v === 'ok') { ready = true; break; }
    await sleep(250);
  }

  const probe = await ev(`(() => {
    const S = window.__igv.S;
    const P = S.panels[S.act];
    const d = P.alignData[${JSON.stringify(TID)}];
    const el = document.querySelector('.track[data-align="${TID}"]');
    const cv = el && el.querySelector('canvas');
    let ink = 0, total = 0;
    const bg = getComputedStyle(document.body).getPropertyValue('--canvas-bg').trim();
    if (cv) {
      const ctx = cv.getContext('2d');
      const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
      total = cv.width * cv.height;
      // 统计非白/非背景像素：读块是灰的，背景是纯色
      for (let i = 0; i < img.length; i += 4) {
        if (img[i + 3] > 10) {
          const r = img[i], g = img[i + 1], b = img[i + 2];
          if (Math.abs(r - g) > 4 || Math.abs(g - b) > 4 || r < 240) ink++;
        }
      }
    }
    return JSON.stringify({
      hasEl: !!el, hidden: el ? el.hidden : null,
      canvasH: cv ? cv.height : 0, ink, total, bg,
      reads: d ? (d.reads ? d.reads.length : null) : null,
      totalReads: d ? d.total : null,
      sampled: d ? d.sampled : null,
      hasSeq: d ? d.hasSeq : null,
      sub: el ? (el.querySelector('.sub') || {}).textContent : null,
      listRows: document.querySelectorAll('#bwList .align-trk').length,
    });
  })()`);
  console.log('PROBE', probe);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const fs = require('fs');
  fs.writeFileSync('tools/_align_view.png', Buffer.from(shot.result.data, 'base64'));
  console.log('wrote tools/_align_view.png');
  if (errors.length) console.log('PAGE ERRORS', errors.slice(0, 3));

  let pass = false;
  try {
    const p = JSON.parse(probe);
    pass = ready && p.hasEl && !p.hidden && p.reads > 0 && p.ink > 500 && p.listRows === 1;
  } catch { pass = false; }
  console.log(pass ? 'RESULT PASS' : 'RESULT FAIL');
  ws.close();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
