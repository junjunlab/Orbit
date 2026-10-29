(async () => {
  const ig = window.__igv;
  const S = ig.S;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(S.data.genes && S.data.genes.length); i++) await sleep(100);

  // 1) built-in RefSeq GAPDH
  const g = (S.data.genes || []).find((x) => x.name === 'GAPDH');
  if (g && !ig.isExpanded(g)) ig.toggleExpand(g);

  // 2) imported GTF GAPDH
  const tid = 'Homo_sapiens.GRCh38.112';
  const t = S.loaded.list.find((x) => x.id === tid);
  for (let i = 0; i < 120 && !(t && t._placed && t._placed.length); i++) await sleep(100);
  const lg = t && (t._placed || []).find((p) => p.g.name === 'GAPDH');
  if (lg && !ig.isLoadedExpanded(t, lg.g)) ig.toggleLoadedExpand(t, lg.g);

  await sleep(800);
  const lay = ig.geneLayout();
  const p1 = lay.placed.find((pp) => pp.g.name === 'GAPDH');
  const p2 = t && (t._placed || []).find((p) => p.g.name === 'GAPDH');
  return {
    refseq: { span: p1 && p1.span, rows: p1 && p1.r, txs: g && g.tx.length },
    gtf: { span: p2 && p2.span, rows: p2 && p2.r, txs: p2 && p2.txl.length },
    view: { chrom: S.view.chrom, start: S.view.start, end: S.view.end },
  };
})();
