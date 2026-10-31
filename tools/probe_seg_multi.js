// 多样本 SEG：一个文件 → 一条热图轨道（行=样本，列=bin）
// 用法：node tools/probe_seg_multi.js [seg文件] [url] [out.png]
const fs = require('fs');
const path = require('path');
const { connect } = require('../../igv_0.3/tools/cdp');

const SEG = process.argv[2] || 'C:/Users/JunJun/Desktop/vcf_seg_sample/TCGA-LUAD-10samples.seg.txt';
const URL_ = process.argv[3] || 'http://127.0.0.1:8797/?db=hg38&locus=chr1:1-30,000,000';
const OUT = process.argv[4] || path.join(__dirname, '_seg_multi.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });
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
    await sleep(250);
    info = await ev(`(() => {
      const S = window.__igv.S;
      const t = (S.bw.list || []).find(x => x.format === 'seg');
      if (!t) return null;
      return { id: t.id, heatmap: !!t.heatmap, samples: t.samples, segments: t.segments,
               names: (t.sampleNames || []).slice(0, 3), on: !!S.bw.on[t.id] };
    })()`);
    if (info) break;
  }
  console.log('track:', JSON.stringify(info));

  const data = await ev(`(async () => {
    const S = window.__igv.S;
    const t = S.bw.list.find(x => x.format === 'seg');
    for (let i = 0; i < 60; i++) {
      const d = S.bw.data[t.id];
      if (d && d.rows && d.rows.length) break;
      await new Promise(r => setTimeout(r, 150));
    }
    const d = S.bw.data[t.id] || {};
    const rows = d.rows || [];
    const flat = rows.flat().filter(v => v != null);
    return { rows: rows.length, bins: d.bins, cells: flat.length,
             min: Math.min(...flat), max: Math.max(...flat),
             canvasH: (document.querySelector('.track[data-bw="' + t.id + '"] canvas') || {}).style.height };
  })()`);
  console.log('matrix:', JSON.stringify(data));

  await sleep(700);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const b64 = shot && shot.result && shot.result.data;
  if (b64) { fs.writeFileSync(OUT, Buffer.from(b64, 'base64')); console.log('saved', OUT); }

  await cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
