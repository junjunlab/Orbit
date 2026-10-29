// 深色主题下再看一眼方向雪佛龙 / 箭头（墨色是按对比度算的，必须两种主题都验）
const fs = require('fs');
const path = require('path');
const { connect } = require('./cdp');
const PORT = process.env.IGV_TEST_PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const LOCUS = process.env.IGV_LOCUS || 'chr19:12790884-12794091';
const OUT = path.join(__dirname, '_gene_arrows_dark.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const cdp = await connect(); const { send } = cdp;
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result.result.value;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `${BASE}/?db=hg38&locus=${LOCUS}` });
  await sleep(600); await ev('localStorage.clear();');
  await send('Page.navigate', { url: `${BASE}/?db=hg38&locus=${LOCUS}` });
  for (let i = 0; i < 160; i++) { if (await ev('!!(window.__igv && window.__igv.S.asm)')) break; await sleep(250); }
  await sleep(1500);
  await ev(`document.querySelector('#btnTheme').click()`);
  await sleep(900);
  const r = JSON.parse(await ev(`(() => {
    const b = document.querySelector('.track[data-track="genes"] .track-body').getBoundingClientRect();
    return JSON.stringify({ x: b.left, y: b.top, w: b.width, h: b.height, theme: __igv.S.theme });
  })()`));
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 4 } });
  fs.writeFileSync(OUT, Buffer.from(s.result.data, 'base64'));
  console.log('theme', r.theme, '->', OUT);
  await cdp.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
