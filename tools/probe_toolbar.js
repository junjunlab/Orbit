/* 工具栏按钮不重叠：量一下「导出」按钮的盒子与文字位置 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 60; i++) { if (document.querySelector('#btnExport')) break; await sleep(100); }
  await sleep(600);
  const box = (sel) => { const e = document.querySelector(sel); const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }; };
  const a = box('#btnExport'), b = box('#btnHome'), c = box('#btnSplit');
  const svg = document.querySelector('#btnExport svg').getBoundingClientRect();
  return {
    split: c, exportBtn: a, home: b,
    svgW: Math.round(svg.width), svgH: Math.round(svg.height),
    overlap: a.r > b.l ? a.r - b.l : 0,
  };
})()
