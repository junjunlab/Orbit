/* 分屏后每个面板画自己那条染色体：三屏分别放 chr17 / chr1 / chr19，
   逐屏采样 ideogram 画布里的红色（着丝粒）重心，位置应各不相同。 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);

  ig.setPanelCount(3);
  await sleep(1200);
  const loci = [['chr17', 7577638, 7584111], ['chr1', 196636713, 196759476], ['chr19', 31573381, 31583361]];
  for (let i = 0; i < 3; i++) {
    await ig.navigatePanel(i, loci[i][0], loci[i][1], loci[i][2], { force: true });
  }
  await sleep(1800);

  const cv = [...document.querySelectorAll('.track[data-track="ideogram"] .pane canvas')];
  const info = cv.map((c, i) => {
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0, sx = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const k = (y * c.width + x) * 4;
        if (d[k] > 120 && d[k + 1] < 70 && d[k + 2] < 70) { n++; sx += x; }
      }
    }
    return { pane: i, cssW: Math.round(c.getBoundingClientRect().width), redPx: n,
      redX: n ? Math.round(sx / n) : -1, dataLen: c.toDataURL().length };
  });
  const labels = [...document.querySelectorAll('.track[data-track="ideogram"] .track-label')]
    .map((l) => l.textContent.trim());
  return { panes: cv.length, info, label: labels[0], chroms: ig.S.panels.map((p) => p.view.chrom) };
})()
