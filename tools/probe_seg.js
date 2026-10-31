// SEG 导入冒烟：上传 .seg.txt → 轨道出现 → 画布有红/蓝柱 → 截图
// 用法：node tools/probe_seg.js [seg文件] [url] [out.png]
const fs = require('fs');
const path = require('path');
const { connect } = require('../../igv_0.3/tools/cdp');

const SEG = process.argv[2] || 'C:/Users/JunJun/Desktop/vcf_seg_sample/TCGA-LUAD-05-4396-01A.seg.txt';
const URL_ = process.argv[3] || 'http://127.0.0.1:8797/?db=hg38&locus=chr1:1-6,000,000';
const OUT = process.argv[4] || path.join(__dirname, '_seg.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await cdp.send('Page.navigate', { url: URL_ });

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(1200);

  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const node = await cdp.send('DOM.querySelector',
    { nodeId: doc.result.root.nodeId, selector: '#fileInput' });
  await cdp.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [SEG] });

  let info = null;
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    info = await ev(`(() => {
      const t = (window.__igv.S.bw.list || []).find(x => x.format === 'seg');
      if (!t) return null;
      return { id: t.id, format: t.format, diverging: !!t.diverging,
               on: !!window.__igv.S.bw.on[t.id], segments: t.segments,
               samples: t.samples, min: t.min, max: t.max };
    })()`);
    if (info && info.on) break;
  }
  console.log('track:', JSON.stringify(info));

  // 等这一屏的数据回来，再检查 bin 的正负分布
  const stats = await ev(`(async () => {
    const S = window.__igv.S;
    for (let i = 0; i < 60; i++) {
      const d = S.bw.data[Object.keys(S.bw.data)[0]];
      if (d && d.values && d.values.length) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const id = (S.bw.list.find(x => x.format === 'seg') || {}).id;
    const d = S.bw.data[id] || {};
    const vs = (d.values || []).map(v => v && v.m).filter(v => v != null);
    return { bins: vs.length, peak: d.peak, trough: d.trough, diverging: d.diverging,
             neg: vs.filter(v => v < 0).length, pos: vs.filter(v => v > 0).length,
             first: vs.slice(0, 4) };
  })()`);
  console.log('data:', JSON.stringify(stats));

  await sleep(600);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const b64 = shot && shot.result && shot.result.data;
  if (b64) { fs.writeFileSync(OUT, Buffer.from(b64, 'base64')); console.log('saved', OUT); }

  await cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
