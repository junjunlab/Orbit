/* 整条染色体（带型最多）下矢量导出的耗时 / 图元数 / PDF 体积 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  await ig.navigate('chr1', 0, ig.S.asm.chroms['chr1']);
  await sleep(1500);
  const t0 = performance.now();
  const vec = await ig.composeVector();
  const t1 = performance.now();
  const svg = window.VEX.toSVG(vec.ops, vec.w, vec.h, { title: 't' });
  const font = await ig.loadCJKFont();
  const blob = await window.VEX.toPDF(vec.ops, vec.w, vec.h, font, { title: 't' });
  const t2 = performance.now();
  return {
    ops: vec.ops.length,
    vectorMs: Math.round(t1 - t0),
    totalMs: Math.round(t2 - t0),
    svgKB: Math.round(svg.length / 1024),
    pdfKB: Math.round(blob.size / 1024),
    size: [Math.round(vec.w), Math.round(vec.h)],
  };
})()
