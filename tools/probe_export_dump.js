/* 把 composePlot() 的结果直接落盘（配合 IGV_DUMP_B64），用于肉眼核对导出图
   URL 不带 #nolabels 时包含左侧轨道名列 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  ig.S.expLabels = location.hash !== '#nolabels';
  if (ig.S.panels.length > 1) { ig.setPanelCount(1); await sleep(900); }
  await sleep(400);
  const cv = ig.composePlot();
  return cv.toDataURL('image/png');
})()
