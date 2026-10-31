(async () => {
  const ig = window.__igv;
  const S = ig.S;
  const spots = [
    ['chr17', 43100000, 43150000, 'BRCA1 left-cross'],
    ['chr17', 7668000, 7690000, 'TP53'],
    ['chr8', 127700000, 127750000, 'MYC'],
    ['chr7', 55000000, 55250000, 'EGFR'],
    ['chr13', 32300000, 32350000, 'BRCA2'],
    ['chr1', 100000000, 100050000, 'random-1']
  ];
  const out = [];
  for (const [chrom, s, e, tag] of spots) {
    try {
      await ig.navigate(chrom, s, e);
      const t0 = performance.now();
      const r = ig.geneLayout();
      out.push({ tag, ms: Math.round(performance.now() - t0), placed: r.placed.length, rows: r.rowsEnd.length, genes: (S.data.genes || []).length });
    } catch (err) {
      out.push({ tag, error: String(err).slice(0, 90) });
    }
  }
  return out;
})();
