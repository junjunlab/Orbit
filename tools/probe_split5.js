/* 5 屏：分别显示 5 个基因 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  ig.setPanelCount(5);
  await sleep(500);
  const genes = ['TP53', 'BRCA1', 'MYC', 'EGFR', 'KRAS'];
  for (let i = 0; i < genes.length; i++) {
    await ig.goPanel(i, genes[i]);
  }
  await sleep(2500);
  ig.setActivePanel(0);
  await sleep(400);
  return {
    panels: ig.S.panels.length,
    panesW: [...document.querySelectorAll('.track[data-track="genes"] .pane')].map((p) => p.clientWidth),
    views: ig.S.panels.map((p) => `${p.view.chrom}:${Math.round((p.view.end - p.view.start) / 1000)}kb`),
    firstGenes: ig.S.panels.map((p) => (p.data.genes || [])[0] ? (p.data.genes || [])[0].name : null),
    counts: ig.S.panels.map((p) => (p.data.genes || []).length),
    heads: [...document.querySelectorAll('#paneHeads .ph-in')].map((i) => i.value),
  };
})()
