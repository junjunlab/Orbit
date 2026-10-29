(async () => {
  const ig = window.__igv;
  const S = ig.S;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(S.data.genes && S.data.genes.length); i++) await sleep(100);
  const g = (S.data.genes || []).find((x) => x.name === 'GAPDH');
  if (!g) return { error: 'GAPDH not in region', genes: (S.data.genes || []).map((x) => x.name).slice(0, 20) };
  if (!ig.isExpanded(g)) ig.toggleExpand(g);
  await sleep(600);
  const lay = ig.geneLayout();
  const p = lay.placed.find((pp) => pp.g.name === 'GAPDH');
  return {
    view: { chrom: S.view.chrom, start: S.view.start, end: S.view.end },
    strand: g.strand,
    txs: (g.tx || []).length,
    span: p ? p.span : null,
    rows: p ? p.r : null,
    canvasH: document.querySelector('.track[data-track="genes"] canvas').getBoundingClientRect().height,
    expanded: [...S.expanded],
  };
})();
