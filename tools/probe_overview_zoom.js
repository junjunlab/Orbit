// 放大截取「全基因组」里当前染色体的那一行，看视野指示条的颜色
const fs = require('fs');
const path = require('path');
const { connect } = require('./cdp');
const PORT = process.env.IGV_TEST_PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, '_overview_zoom.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const cdp = await connect();
  const { send } = cdp;
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
    return r.result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `${BASE}/?db=hg38&locus=chr7:5525000-5530000` });
  await sleep(700);
  await ev('localStorage.clear(); sessionStorage.clear();');
  await send('Page.navigate', { url: `${BASE}/?db=hg38&locus=chr7:5525000-5530000` });
  for (let i = 0; i < 120; i++) { if (await ev('!!(window.__igv && window.__igv.S.asm)')) break; await sleep(250); }
  await sleep(1200);
  await ev('window.__igv.setPanelCount(2)');
  await sleep(1500);
  if (process.env.IGV_DARK) { await ev(`document.querySelector('#btnTheme').click()`); await sleep(1200); }
  const r = JSON.parse(await ev(`(() => {
    const row = document.querySelector('.track[data-track="overview"]');
    const p = row.querySelector('.pane[data-p="0"]').getBoundingClientRect();
    // 当前染色体那一行：OV.top=8, rowH=14
    const chroms = Object.keys(window.__igv.S.asm.chroms);
    const i = chroms.indexOf(window.__igv.S.panels[0].view.chrom);
    return JSON.stringify({ x: p.left, y: p.top + 8 + i * 14 - 6, w: Math.min(260, p.width), h: 26 });
  })()`));
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 5 },
  });
  fs.writeFileSync(OUT, Buffer.from(s.result.data, 'base64'));
  console.log('clip', JSON.stringify(r), '->', OUT);
  await cdp.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
