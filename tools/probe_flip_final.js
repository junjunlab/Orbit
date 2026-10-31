// 最终效果图：JUNB 外显子里的 60bp，序列轨道已翻转 + 按钮高亮
const fs = require('fs'), path = require('path');
const { connect } = require('./cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'http://127.0.0.1:8799/?db=hg38&locus=chr19:12791460-12791520';
(async () => {
  const cdp = await connect(); const { send } = cdp;
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result.result.value;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(600); await ev('localStorage.clear();');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 160; i++) { if (await ev('!!(window.__igv && window.__igv.S.asm)')) break; await sleep(250); }
  await sleep(2000);
  await ev(`document.querySelector('#seqFlip').click()`);
  await sleep(800);
  const r = JSON.parse(await ev(`(() => {
    const v = document.querySelector('#view').getBoundingClientRect();
    return JSON.stringify({ x: v.left, y: v.top, w: v.width, h: Math.min(v.height, 420) });
  })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + 120, y: r.y + 40 });
  await sleep(200);
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 2 } });
  fs.writeFileSync(path.join(__dirname, '_flip_final.png'), Buffer.from(s.result.data, 'base64'));
  console.log('flip', await ev('JSON.stringify({flip: __igv.S.seqFlip, pressed: document.querySelector("#seqFlip").getAttribute("aria-pressed")})'));
  await cdp.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
