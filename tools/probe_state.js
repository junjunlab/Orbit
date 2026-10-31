(() => {
  const ig = window.__igv;
  if (!ig) return { error: 'no __igv', title: document.title, ready: document.readyState };
  const S = ig.S;
  const genes = S.data.genes || [];
  const view = { chrom: S.view.chrom, start: S.view.start, end: S.view.end };
  const inView = genes.filter(g => g.chrom === view.chrom && g.end > view.start && g.start < view.end);
  const crossLeft = inView.filter(g => g.start < view.start).map(g => ({ name: g.name, start: g.start, end: g.end }));
  return {
    asm: S.asm && S.asm.id,
    view,
    nGenesTotal: genes.length,
    nGenesInView: inView.length,
    crossLeftCount: crossLeft.length,
    crossLeftSample: crossLeft.slice(0, 5)
  };
})();
