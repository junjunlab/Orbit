// 文档截图/校验共用小工具：连到常驻无头 Chrome（9222），复用同一个页面会话。
// 页面里的导入结果会保留，所以每个 stage 脚本不用重复上传 BAM。
const fs = require('fs');
const path = require('path');
const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');

const OUT = path.join(__dirname, '..', 'docs', 'examples');
const BASE = process.env.ORBIT_URL || 'http://127.0.0.1:8811';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(opts = {}) {
  const cdp = await connect({ dpr: '2' });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: opts.width || 1440, height: opts.height || 900, deviceScaleFactor: 2, mobile: false });

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  return { cdp, ev };
}

async function goto(ev, cdp, url) {
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 150; i++) {
    if (await ev('!!window.__igv')) break;
    await sleep(200);
  }
  await sleep(1200);
}

// 走真实 <input type=file> 路径导入，和服务端上传/建索引一致
async function importFiles(cdp, ev, files) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const node = await cdp.send('DOM.querySelector',
    { nodeId: doc.result.root.nodeId, selector: '#fileInput' });
  await cdp.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files });
  return true;
}

async function shot(cdp, name, clip) {
  const args = { format: 'png' };
  if (clip) args.clip = { ...clip, scale: 1 };
  const s = await cdp.send('Page.captureScreenshot', args);
  const b64 = s && s.result && s.result.data;
  if (!b64) throw new Error('captureScreenshot returned nothing');
  const p = path.join(OUT, name);
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  console.log('saved', p, (fs.statSync(p).size / 1e3).toFixed(0) + ' KB');
  return p;
}

// 把 canvas/整页里的一个元素截图（PNG dataURL），用于弹窗配图
async function shotEl(ev, cdp, selector, name, pad = 8) {
  const box = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return null; const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  if (!box) throw new Error('element not found: ' + selector);
  return shot(cdp, name, {
    x: Math.max(0, Math.round(box.x - pad)), y: Math.max(0, Math.round(box.y - pad)),
    width: Math.round(box.w + pad * 2), height: Math.round(box.h + pad * 2),
  });
}

module.exports = { open, goto, importFiles, shot, shotEl, sleep, BASE, OUT };
