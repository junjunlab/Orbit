// 把指定 SVG 文件渲染成 PNG（用 CDP 起一个 Chrome，按 SVG 尺寸截图）
const fs = require('fs');
const { connect } = require('./cdp');

const file = process.argv[2];
const out = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const svg = fs.readFileSync(file, 'utf8');
  const m = /width="([\d.]+)" height="([\d.]+)"/.exec(svg);
  const w = Math.ceil(parseFloat(m[1])), h = Math.ceil(parseFloat(m[2]));
  const cdp = await connect({ clean: false });
  try {
    await cdp.send('Page.enable');
    await cdp.send('Page.setViewport', { width: w, height: h, deviceScaleFactor: 2 });
    const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    await cdp.send('Page.navigate', { url: dataUrl });
    await sleep(800);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('wrote', out, w + 'x' + h);
  } finally {
    await cdp.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
