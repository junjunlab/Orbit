/* 修复后的网页状态截图（三屏 acbt/myc/jund） */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !window.__igv; i++) await sleep(100);
  const ig = window.__igv;
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  ig.setPanelCount(3);
  await sleep(1200);
  const loci = [['chr7', 5524570, 5534023], ['chr8', 127732434, 127745951], ['chr1', 58777791, 58787047]];
  for (let i = 0; i < 3; i++) await ig.navigatePanel(i, ...loci[i], { force: true });
  await sleep(2000);
  const cv = document.querySelector('.track[data-bw="Scr_R2_input"] .pane[data-p="0"] canvas');
  const r = cv.getBoundingClientRect();
  return { ok: true, bwTop: Math.round(r.top), bwH: Math.round(r.height), dpr: ig.S.dpr };
})()
