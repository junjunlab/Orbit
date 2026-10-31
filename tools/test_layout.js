(() => {
  const ig = window.__igv;
  if (!ig) return { error: 'no __igv' };
  const S = ig.S;
  const t0 = performance.now();
  const r = ig.geneLayout();
  const t1 = performance.now();
  return {
    ms: Math.round(t1 - t0),
    count: r.count,
    placed: r.placed.length,
    maxRows: r.maxRows,
    rowsEndLen: r.rowsEnd.length,
    bpPerPx: Math.round(r.bpPerPx * 100) / 100,
    view: { chrom: S.view.chrom, start: S.view.start, end: S.view.end }
  };
})();
