/* 检查矢量导出里有没有「文字压文字」：按 text 图元的包围盒两两求交 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  if (location.hash === '#split3') {
    ig.setPanelCount(3);
    await sleep(1200);
    const loci = [['chr17', 7577638, 7584111], ['chr1', 196636713, 196759476], ['chr19', 31573381, 31583361]];
    for (let i = 0; i < 3; i++) await ig.navigatePanel(i, loci[i][0], loci[i][1], loci[i][2], { force: true });
    await sleep(1500);
  }
  const vec = await ig.composeVector();
  const ts = vec.ops.filter((o) => o.k === 'text').map((o) => ({
    s: o.s, x: o.x, y: o.y - o.size * 0.8, w: o.w, h: o.size * 1.1,
  }));
  const hits = [];
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      const a = ts[i], b = ts[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 2 && oy > 2) {
        const frac = (ox * oy) / Math.min(a.w * a.h, b.w * b.h);
        if (frac > 0.15) hits.push({ a: a.s, b: b.s, ox: Math.round(ox), oy: Math.round(oy), frac: Math.round(frac * 100) });
      }
    }
  }
  return { texts: ts.length, overlaps: hits.slice(0, 12), count: hits.length, size: [Math.round(vec.w), Math.round(vec.h)] };
})()
