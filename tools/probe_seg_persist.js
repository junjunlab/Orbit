// 验证「导入的热图轨道在重开页面后仍然勾选并渲染」
// 用法：node tools/probe_seg_persist.js [seg文件] [url] [out.png]
const fs = require('fs');
const path = require('path');
const { connect } = require('../../igv_0.3/tools/cdp');

const SEG = process.argv[2] || 'C:/Users/JunJun/Desktop/vcf_seg_sample/TCGA-LUAD-10samples.seg.txt';
const URL_ = process.argv[3] || 'http://127.0.0.1:8799/?db=hg38&locus=chr1:55,000,000-62,000,000';
const OUT = process.argv[4] || path.join(__dirname, '_seg_persist.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  const waitApp = async () => {
    for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
    await sleep(1200);
  };

  // ---- 1. 干净起点：清掉 prefs，模拟「第一次使用」 ----
  await cdp.send('Page.navigate', { url: URL_ });
  await waitApp();
  await ev('localStorage.clear()');
  await cdp.send('Page.navigate', { url: URL_ });
  await waitApp();
  console.log('clean prefs:', await ev('JSON.stringify(window.__igv.S.bw.onSaved)'));

  // ---- 2. 导入 10 样本 SEG ----
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const node = await cdp.send('DOM.querySelector',
    { nodeId: doc.result.root.nodeId, selector: '#fileInput' });
  await cdp.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [SEG] });

  let info = null;
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    info = await ev(`(() => {
      const S = window.__igv.S;
      const t = (S.bw.list || []).filter(x => x.format === 'seg').pop();
      if (!t) return null;
      return { id: t.id, heatmap: !!t.heatmap, samples: t.samples,
               on: !!S.bw.on[t.id], saved: S.bw.onSaved[t.id] };
    })()`);
    if (info && info.on) break;
  }
  console.log('after import:', JSON.stringify(info));
  console.log('ls prefs:', await ev(`localStorage.getItem('orbit.prefs.v1')`));

  // 等矩阵回来
  const draw = await ev(`(async () => {
    const S = window.__igv.S;
    const t = S.bw.list.filter(x => x.format === 'seg').pop();
    for (let i = 0; i < 80; i++) {
      const d = S.bw.data[t.id];
      if (d && d.rows && d.rows.length) break;
      await new Promise(r => setTimeout(r, 150));
    }
    const d = S.bw.data[t.id] || {};
    const el = document.querySelector('.track[data-bw="' + t.id + '"]');
    const cv = el && el.querySelector('canvas');
    return { rows: (d.rows || []).length, bins: d.bins,
             hidden: el ? !!el.hidden : null, canvasH: cv ? cv.style.height : null };
  })()`);
  console.log('first render:', JSON.stringify(draw));

  // ---- 3. 重开页面（fresh 启动），确认轨道仍勾选且画出来 ----
  await cdp.send('Page.navigate', { url: URL_ });
  await waitApp();
  const after = await ev(`(async () => {
    const S = window.__igv.S;
    const t = (S.bw.list || []).filter(x => x.format === 'seg').pop();
    if (!t) return { missing: true };
    for (let i = 0; i < 80; i++) {
      const d = S.bw.data[t.id];
      if (d && d.rows && d.rows.length) break;
      await new Promise(r => setTimeout(r, 150));
    }
    const el = document.querySelector('.track[data-bw="' + t.id + '"]');
    const cv = el && el.querySelector('canvas');
    const d = S.bw.data[t.id] || {};
    return { id: t.id, on: !!S.bw.on[t.id], saved: S.bw.onSaved[t.id],
             hidden: el ? !!el.hidden : null, canvasH: cv ? cv.style.height : null,
             rows: (d.rows || []).length };
  })()`);
  console.log('after reload:', JSON.stringify(after));

  await sleep(900);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const b64 = shot && shot.result && shot.result.data;
  if (b64) { fs.writeFileSync(OUT, Buffer.from(b64, 'base64')); console.log('saved', OUT); }

  await cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
