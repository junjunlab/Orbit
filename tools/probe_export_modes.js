/* 导出：带/不带左侧轨道名两种宽高对比；单屏时不应有抬头行 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  if (ig.S.panels.length < 2) { ig.setPanelCount(2); await sleep(1000); }
  await sleep(300);

  const dim = (cv) => ({ w: cv.width, h: cv.height });
  ig.S.expLabels = true;
  const withLab = dim(ig.composePlot(2));
  ig.S.expLabels = false;
  const without = dim(ig.composePlot(2));
  ig.S.expLabels = true;

  // 单屏：不应出现 20px 抬头
  ig.setPanelCount(1);
  await sleep(900);
  const single = dim(ig.composePlot(2));

  ig.setPanelCount(3);
  await sleep(1200);
  const three = dim(ig.composePlot(2));

  return {
    withLab, without,
    labelColPx: Math.round((withLab.w - without.w) / 2),
    single, three,
    headBandPx: Math.round((three.h - single.h) / 2),
  };
})()
