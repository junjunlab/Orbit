/* 单屏导出图（应无「位置」抬头，标尺右上角保留区间胶囊） */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  if (ig.S.panels.length > 1) ig.setPanelCount(1);
  await sleep(1000);
  const cv = ig.composePlot(2);
  return cv.toDataURL('image/png');
})()
