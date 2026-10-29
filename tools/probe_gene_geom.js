/* 打印当前视野里基因的几何与 exon 结构，定位箭头/雪佛龙为什么看不见 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 160 && !(window.__igv && window.__igv.S.asm); i++) await sleep(100);
  const ig = window.__igv;
  const L = ig.geneLayout();
  const canvas = document.querySelector('.track[data-track="genes"] .pane[data-p="0"] canvas')
    || document.querySelector('.track[data-track="genes"] canvas');
  const w = canvas ? canvas.getBoundingClientRect().width : 0;
  const bpPerPx = (ig.S.view.end - ig.S.view.start) / w;
  return {
    view: `${ig.S.view.chrom}:${ig.S.view.start}-${ig.S.view.end}`,
    w: Math.round(w),
    bpPerPx: +bpPerPx.toFixed(2),
    count: L.count,
    genes: L.placed.map((p) => ({
      name: p.g.name,
      strand: p.g.strand,
      x1: Math.round(p.x1), x2: Math.round(p.x2),
      offLeft: p.x1 < 0, offRight: p.x2 > w,
      tx: (p.txl || []).map((t) => ({
        n: (t.exons || []).length,
        exons: (t.exons || []).slice(0, 4),
        cds: [t.cdsStart, t.cdsEnd],
      })),
    })),
  };
})()
