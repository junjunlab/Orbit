// 把 docs/ui-review/wechat.html 渲染成一张高清长图（公众号用）
//   node tools/make_long_image.js [cssWidth] [scale] [out.png]
const fs = require('fs'), path = require('path');
const { connect } = require('./cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const W = +(process.argv[2] || 750);
const SCALE = +(process.argv[3] || 2);
const OUT = process.argv[4] || 'docs/ui-review/igvlocal-ui-review-long.png';
const SRC = path.join(__dirname, '..', 'docs', 'ui-review', 'wechat.html');

(async () => {
  const cdp = await connect(); const { send } = cdp;
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result.result.value;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: 1200, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + SRC.replace(/\\/g, '/') });
  await sleep(1600);
  // 等图片全部解码完成
  await ev(`Promise.all([...document.images].map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; })))`);
  await sleep(400);
  const h = Math.ceil(await ev('document.documentElement.scrollHeight'));
  const w = Math.ceil(await ev('document.documentElement.scrollWidth'));
  const s = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: w, height: h, scale: SCALE },
  });
  const buf = Buffer.from(s.result.data, 'base64');
  fs.writeFileSync(path.join(__dirname, '..', OUT), buf);
  console.log(JSON.stringify({ cssW: w, cssH: h, scale: SCALE,
    pxW: w * SCALE, pxH: h * SCALE, mb: +(buf.length / 1048576).toFixed(2), out: OUT }));
  await cdp.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
