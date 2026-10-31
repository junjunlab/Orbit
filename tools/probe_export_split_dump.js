/* 三屏 + 带左侧名列，把 composePlot() 的结果落盘（配合 IGV_DUMP_B64） */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  ig.S.expLabels = location.hash !== '#nolabels';
  ig.setPanelCount(3);
  await sleep(1200);
  const loci = [['chr17', 7577638, 7584111], ['chr1', 196636713, 196759476], ['chr19', 31573381, 31583361]];
  for (let i = 0; i < 3; i++) await ig.navigatePanel(i, loci[i][0], loci[i][1], loci[i][2], { force: true });
  await sleep(1500);
  const cv = ig.composePlot();
  return cv.toDataURL('image/png');
})()
