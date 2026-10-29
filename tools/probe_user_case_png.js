/* 三屏 case 的位图导出（composePlot）落盘 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !window.__igv; i++) await sleep(100);
  const ig = window.__igv;
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  ig.setPanelCount(3);
  await sleep(1200);
  const loci = [['chr7', 5524570, 5534023], ['chr8', 127732434, 127745951], ['chr1', 58777791, 58787047]];
  for (let i = 0; i < 3; i++) await ig.navigatePanel(i, ...loci[i], { force: true });
  await sleep(1800);
  const cv = ig.composePlot(2);
  return cv.toDataURL('image/png');
})()
