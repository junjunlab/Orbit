const fs = require('fs'), path = require('path');
const { connect } = require('./cdp');
const PORT = process.env.IGV_TEST_PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const cdp = await connect(); const { send } = cdp;
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result.result.value;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `${BASE}/?db=hg38&locus=chr19:12791400-12791460` });
  await sleep(600);
  await ev('localStorage.clear();');
  await send('Page.navigate', { url: `${BASE}/?db=hg38&locus=chr19:12791400-12791460` });
  for (let i = 0; i < 120; i++) { if (await ev('!!(window.__igv && window.__igv.S.asm)')) break; await sleep(250); }
  await sleep(1500);
  // hover 到轨道上让按钮出现
  const r = JSON.parse(await ev(`(() => { const b = document.querySelector('.track[data-track="seq"]').getBoundingClientRect();
     return JSON.stringify({x:b.left,y:b.top,w:420,h:b.height}); })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + 200, y: r.y + 20 });
  await sleep(300);
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 3 } });
  fs.writeFileSync(path.join(__dirname, '_seq_flip_btn.png'), Buffer.from(s.result.data, 'base64'));
  console.log('btn', await ev(`(() => { const b = document.querySelector('#seqFlip'); const cs = getComputedStyle(b);
    return JSON.stringify({opacity: cs.opacity, w: b.offsetWidth, h: b.offsetHeight, pressed: b.getAttribute('aria-pressed')}); })()`));
  await cdp.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
