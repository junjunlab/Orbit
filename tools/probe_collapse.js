(async () => {
  const ig = window.__igv;
  const S = ig.S;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  S.loaded.expanded.clear();
  ig.scheduleRender();
  await sleep(500);
  const tid = 'Homo_sapiens.GRCh38.112';
  const t = S.loaded.list.find((x) => x.id === tid);
  return {
    expanded: [...S.loaded.expanded],
    rows: (t._placed || []).map((p) => ({ gene: p.g.name, strand: p.g.strand, span: p.span, txs: p.txl.length, toggle: p.tgl ? { x: Math.round(p.tgl.x), left: p.tgl.left } : null })),
    canvasH: document.querySelector('.track[data-loaded="' + tid + '"] canvas').getBoundingClientRect().height,
  };
})();
