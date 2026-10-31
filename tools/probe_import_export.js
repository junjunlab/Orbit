// 端到端：真实「导入文件 → 导出 SVG/PDF」，核对导入轨道在导出图里的保真度
//
//   node tools/probe_import_export.js <file> <outPrefix> [chrom] [start] [end]
//
// 做法：用 CDP 的 DOM.setFileInputFiles 把真实文件塞进 #fileInput，再派发 change，
// 走的是和用户点「导入」完全一样的链路；然后调 composeVector 拿矢量结果落盘，
// 同时截一张网页图，便于和导出图逐行对照。
const fs = require('fs');
const path = require('path');
const { connect } = require('./cdp');

const file = process.argv[2];
const prefix = process.argv[3] || path.basename(file).replace(/\W+/g, '_');
const chrom = process.argv[4] || 'chr1';
const start = parseInt(process.argv[5] || '99000', 10);
const end = parseInt(process.argv[6] || '131000', 10);
const PORT = process.env.IGV_TEST_PORT || '8799';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE_JS = `(() => {
  const ig = window.__igv;
  const out = { tracks: [], errors: [] };
  for (const t of (ig.S.loaded.list || [])) out.tracks.push({ id: t.id, kind: t.kind, name: t.name, on: ig.S.loaded.on[t.id] });
  for (const t of (ig.S.bw.list || [])) out.tracks.push({ id: t.id, kind: 'bw', name: t.name });
  return out;
})()`;

const EXPORT_JS = `(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(300);
  // 诊断：哪些轨道进了 plotRows / 它们的画布是否会被记录
  const diag = { rows: [] };
  for (const r of ig.plotRows()) {
    const tr = r.body.parentElement;
    const cs = [...r.body.querySelectorAll('canvas')];
    diag.rows.push({
      id: tr ? (tr.dataset.track || tr.dataset.bw || tr.dataset.align || tr.dataset.loaded || '?') : '?',
      canvases: cs.length,
      canvasWH: cs.map((c) => Math.round(c.getBoundingClientRect().width) + 'x' + Math.round(c.getBoundingClientRect().height)),
      rect: [Math.round(r.br.left), Math.round(r.br.top), Math.round(r.br.width), Math.round(r.br.height)],
      hidden: tr ? tr.hidden : null,
    });
  }
  const vec = await ig.composeVector();
  const svg = VEX.toSVG(vec.ops, vec.w, vec.h, { title: 'export' });
  // 顺便统计各类图元，方便判断「有没有画出来」
  const kinds = {};
  for (const op of vec.ops) kinds[op.k] = (kinds[op.k] || 0) + 1;
  const texts = vec.ops.filter((o) => o.k === 'text').map((o) => o.s);
  // 同一份 ops 再走一遍 PDF 序列化（PDF 有自己的一套坐标翻转/字体嵌入）
  let pdfB64 = '';
  try {
    const font = await ig.loadCJKFont();
    const blob = await VEX.toPDF(vec.ops, vec.w, vec.h, font, { title: 'export' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    pdfB64 = btoa(s);
  } catch (e) { pdfB64 = 'ERR:' + e.message; }
  return { svg, pdfB64, w: vec.w, h: vec.h, kinds, n: vec.ops.length, diag, texts };
})()`;

(async () => {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error('file not found: ' + abs);
  const cdp = await connect();
  try {
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    await sleep(3500);

    // 等数据就绪
    await cdp.send('Runtime.evaluate', {
      expression: `(async () => { const ig = window.__igv;
        for (let i = 0; i < 120 && !(ig.S.data && ig.S.data.genes); i++) await new Promise(r => setTimeout(r, 100));
        return 1; })()`,
      awaitPromise: true, returnByValue: true,
    });

    // 走真实文件输入
    const doc = await cdp.send('DOM.getDocument', { depth: -1 });
    const q = await cdp.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#fileInput' });
    if (!q.result.nodeId) throw new Error('#fileInput not found');
    await cdp.send('DOM.setFileInputFiles', { files: [abs], nodeId: q.result.nodeId });
    await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('#fileInput').dispatchEvent(new Event('change'))`,
    });

    // 等导入完成（轮询轨道列表变化）
    let info = null;
    for (let i = 0; i < 120; i++) {
      await sleep(250);
      const r = await cdp.send('Runtime.evaluate', { expression: PAGE_JS, returnByValue: true });
      info = r.result.result.value;
      if (info && info.tracks.length) break;
    }
    console.log('tracks after import:', JSON.stringify(info && info.tracks));

    // 定位到示例文件覆盖的区间
    await cdp.send('Runtime.evaluate', {
      expression: `window.__igv.navigate('${chrom}', ${start}, ${end})`, awaitPromise: true, returnByValue: true,
    });
    await sleep(2500);

    const ex = await cdp.send('Runtime.evaluate', { expression: EXPORT_JS, awaitPromise: true, returnByValue: true });
    if (ex.result.exceptionDetails) throw new Error(JSON.stringify(ex.result.exceptionDetails).slice(0, 500));
    const val = ex.result.result.value;
    fs.writeFileSync(`${prefix}.svg`, val.svg);
    if (val.pdfB64 && !val.pdfB64.startsWith('ERR:')) {
      fs.writeFileSync(`${prefix}.pdf`, Buffer.from(val.pdfB64, 'base64'));
      console.log('PDF ->', `${prefix}.pdf`, fs.statSync(`${prefix}.pdf`).size, 'bytes');
    } else {
      console.log('PDF -> 生成失败:', val.pdfB64);
    }
    console.log(`SVG -> ${prefix}.svg  ${Math.round(val.w)}x${Math.round(val.h)}  ops=${val.n}`, JSON.stringify(val.kinds));
    console.log('rows:', JSON.stringify(val.diag.rows, null, 1));
    console.log('texts:', JSON.stringify(val.texts));

    // 网页截图（同一视图）
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${prefix}_screen.png`, Buffer.from(shot.result.data, 'base64'));
    console.log('screen ->', `${prefix}_screen.png`);
  } finally {
    await cdp.close();
  }
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
