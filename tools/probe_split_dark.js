/* 深色主题 + 三屏：确认每屏示意图仍在、且配色未被主题影响 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  ig.setPanelCount(3);
  await sleep(1000);
  const loci = [['chr17', 7577638, 7584111], ['chr1', 196636713, 196759476], ['chr19', 31573381, 31583361]];
  for (let i = 0; i < 3; i++) await ig.navigatePanel(i, loci[i][0], loci[i][1], loci[i][2], { force: true });
  document.body.setAttribute('data-theme', 'dark');
  ig.scheduleRender();
  await sleep(1200);
  const cvs = [...document.querySelectorAll('.track[data-track="ideogram"] .pane canvas')];
  return { panes: cvs.length, widths: cvs.map((c) => Math.round(c.getBoundingClientRect().width)) };
})()
