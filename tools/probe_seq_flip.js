// 序列轨道 Flip strand：点按钮前后各截一张，比对像素与状态
const fs = require('fs');
const path = require('path');
const { connect } = require('./cdp');
const PORT = process.env.IGV_TEST_PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const LOCUS = process.env.IGV_LOCUS || 'chr19:12791400-12791800';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const cdp = await connect();
  const { send } = cdp;
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `${BASE}/?db=hg38&locus=${LOCUS}` });
  await sleep(600);
  await ev('localStorage.clear(); sessionStorage.clear();');
  await send('Page.navigate', { url: `${BASE}/?db=hg38&locus=${LOCUS}` });
  for (let i = 0; i < 120; i++) { if (await ev('!!(window.__igv && window.__igv.S.asm)')) break; await sleep(250); }
  await sleep(1800);

  const rect = JSON.parse(await ev(`(() => {
    const b = document.querySelector('.track[data-track="seq"] .track-body').getBoundingClientRect();
    return JSON.stringify({ x: b.left, y: b.top, w: b.width, h: b.height });
  })()`));

  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 },
    });
    const p = path.join(__dirname, name);
    fs.writeFileSync(p, Buffer.from(s.result.data, 'base64'));
    return p;
  };

  const before = await shot('_seq_flip_before.png');
  const pressed0 = await ev(`document.querySelector('#seqFlip').getAttribute('aria-pressed')`);
  await ev(`document.querySelector('#seqFlip').click()`);
  await sleep(500);
  const after = await shot('_seq_flip_after.png');
  const pressed1 = await ev(`document.querySelector('#seqFlip').getAttribute('aria-pressed')`);
  const st = await ev(`JSON.stringify({ flip: window.__igv.S.seqFlip,
      prefs: JSON.parse(localStorage.getItem('igvlocal.prefs.v1')||'{}').seqFlip })`);
  // 互补表抽查
  const comp = await ev(`JSON.stringify({
      A: __igv.complementBase('A'), T: __igv.complementBase('T'),
      g: __igv.complementBase('g'), R: __igv.complementBase('R'),
      N: __igv.complementBase('N') })`);

  console.log('rect', JSON.stringify(rect));
  console.log('aria-pressed', pressed0, '->', pressed1);
  console.log('state', st);
  console.log('complement', comp);
  console.log('shots', before, after);
  await cdp.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
