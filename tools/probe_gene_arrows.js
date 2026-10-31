// 放大截取 RefSeq 行的基因模型，看箭头到底画没画
const fs = require('fs');
const path = require('path');
const { connect } = require('./cdp');
const PORT = process.env.IGV_TEST_PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, '_gene_arrows.png');
const LOCUS = process.env.IGV_LOCUS || 'chr19:12790884-12794091';
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
  await send('Page.navigate', { url: `${BASE}/?db=hg38&locus=${LOCUS}` });
  await sleep(700);
  await ev('localStorage.clear(); sessionStorage.clear();');
  await send('Page.navigate', { url: `${BASE}/?db=hg38&locus=${LOCUS}` });
  for (let i = 0; i < 120; i++) { if (await ev('!!(window.__igv && window.__igv.S.asm)')) break; await sleep(250); }
  await sleep(1500);
  const r = JSON.parse(await ev(`(() => {
    const row = document.querySelector('.track[data-track="genes"]');
    const b = row.querySelector('.track-body').getBoundingClientRect();
    return JSON.stringify({ x: b.left, y: b.top, w: b.width, h: b.height });
  })()`));
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 4 },
  });
  fs.writeFileSync(OUT, Buffer.from(s.result.data, 'base64'));
  console.log('clip', JSON.stringify(r), '->', OUT);
  await cdp.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
