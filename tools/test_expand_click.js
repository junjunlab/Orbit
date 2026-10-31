// Real-mouse-click test for the transcript expander.
//   node tools/test_expand_click.js
// Verifies: clicking the +/- box in the canvas expands/collapses the gene, and
// clicking a transcript name selects the gene. Requires Chrome on 9222 and the
// dev server on 8799.
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = process.env.IGV_TEST_PORT || '8799';
const URL = `http://localhost:${PORT}/?db=hg38&locus=chr8:127735000-127743000`;
const OUT = process.argv[2] || 'tools/_expand_click.png';

async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('no page target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; waiting.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      throw new Error('JS error: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
    }
    return r.result.result.value;
  };

  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 80; i++) {
    const v = await evaluate('!!(window.__igv && window.__igv.S && window.__igv.S.data.genes && window.__igv.S.data.genes.length)');
    if (v) break;
    await sleep(250);
  }
  // make sure nothing is expanded yet
  await evaluate('(() => { const I=window.__igv; I.S.expanded.clear(); I.S.sel=null; I.scheduleRender(); return 1; })()');
  await sleep(300);

  // canvas position + the toggle box of MYC (canvas-local coords)
  const geo = await evaluate(`(() => {
    const I = window.__igv;
    const g = I.S.data.genes.find(x => x.name === 'MYC');
    const c = document.querySelector('.track[data-track="genes"] canvas');
    const r = c.getBoundingClientRect();
    const tgl = (I.S._geneToggles || []).find(t => t.key === I.geneKey(g));
    return { left: r.left, top: r.top, tgl: tgl ? { x: tgl.x, y: tgl.y, w: tgl.w, h: tgl.h } : null,
             key: I.geneKey(g) };
  })()`);
  if (!geo.tgl) throw new Error('no toggle box for MYC');
  console.log('TOGGLE', JSON.stringify(geo));

  const clickAt = async (cx, cy) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1, buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(350);
  };

  // 1) click the "+" box -> the gene must expand
  await clickAt(geo.left + geo.tgl.x + geo.tgl.w / 2, geo.top + geo.tgl.y + geo.tgl.h / 2);
  const afterExpand = await evaluate(`(() => {
    const I = window.__igv;
    const g = I.S.data.genes.find(x => x.name === 'MYC');
    const L = I.geneLayout();
    const e = L.placed.find(p => p.g === g);
    return { expanded: I.isExpanded(g), span: e ? e.span : null, rows: L.maxRows,
             selected: !!(I.S.sel && I.S.sel.name === 'MYC') };
  })()`);
  console.log('AFTER TOGGLE CLICK', JSON.stringify(afterExpand));

  // 2) click the second transcript's name -> the gene must be selected
  const label = await evaluate(`(() => {
    const I = window.__igv;
    const g = I.S.data.genes.find(x => x.name === 'MYC');
    const c = document.querySelector('.track[data-track="genes"] canvas');
    const r = c.getBoundingClientRect();
    const L = I.geneLayout();
    const p = L.placed.find(pp => pp.g === g);
    const t = p.txl[1];
    const cy = 6 + (p.r + 1) * 22 + 22 / 2;
    // replay the renderer placement to get the exact label box
    const spot = (function(){
      const text = '↳ ' + t.name;
      const w = L.w;
      const tw = (function(){ const cv=document.createElement('canvas'); const cx=cv.getContext('2d');
        cx.font='600 11px system-ui, -apple-system, "Segoe UI", sans-serif'; return cx.measureText(text).width; })();
      const lo = 2, hi = ((t.start - I.S.view.start) / (I.S.view.end - I.S.view.start)) * w - 3;
      if (hi - lo >= tw + 2) return { x: lo, tw };
      return { x: 2, tw };
    })();
    return { left: r.left, top: r.top, x: spot.x + spot.tw / 2, y: cy, tx: t.name };
  })()`);
  console.log('LABEL TARGET', JSON.stringify(label));
  await evaluate('(() => { window.__igv.S.sel = null; window.__igv.renderInfo(); return 1; })()');
  await sleep(200);
  await clickAt(label.left + label.x, label.top + label.y);
  const afterLabel = await evaluate(`(() => {
    const I = window.__igv;
    return { selected: I.S.sel ? I.S.sel.name : null,
             tip: document.querySelector('#tooltip') ? document.querySelector('#tooltip').textContent : '' };
  })()`);
  console.log('AFTER LABEL CLICK', JSON.stringify(afterLabel));

  // 3) click the toggle again -> collapse
  const geo2 = await evaluate(`(() => {
    const I = window.__igv;
    const g = I.S.data.genes.find(x => x.name === 'MYC');
    const c = document.querySelector('.track[data-track="genes"] canvas');
    const r = c.getBoundingClientRect();
    const tgl = (I.S._geneToggles || []).find(t => t.key === I.geneKey(g));
    return { left: r.left, top: r.top, tgl: tgl ? { x: tgl.x, y: tgl.y, w: tgl.w, h: tgl.h } : null };
  })()`);
  await clickAt(geo2.left + geo2.tgl.x + geo2.tgl.w / 2, geo2.top + geo2.tgl.y + geo2.tgl.h / 2);
  const afterCollapse = await evaluate(`(() => {
    const I = window.__igv;
    const g = I.S.data.genes.find(x => x.name === 'MYC');
    const L = I.geneLayout();
    const e = L.placed.find(p => p.g === g);
    return { expanded: I.isExpanded(g), span: e ? e.span : null, rows: L.maxRows };
  })()`);
  console.log('AFTER COLLAPSE CLICK', JSON.stringify(afterCollapse));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('wrote', OUT);

  const pass = afterExpand.expanded && afterExpand.span === 2 && afterExpand.rows >= 2
    && afterLabel.selected === 'MYC'
    && !afterCollapse.expanded && afterCollapse.span === 1;
  console.log(pass ? 'RESULT PASS' : 'RESULT FAIL');
  ws.close();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
