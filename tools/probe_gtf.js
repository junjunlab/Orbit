(() => {
  const ig = window.__igv;
  if (!ig) return { error: 'no __igv' };
  const S = ig.S;
  const tid = 'Homo_sapiens.GRCh38.112';
  const cache = (S.loaded.data || {})[tid] || null;
  const genes = (cache && cache.genes) || [];
  const el = document.querySelector('.track[data-loaded="' + tid + '"]');
  return {
    view: { chrom: S.view.chrom, start: S.view.start, end: S.view.end },
    loadedList: (S.loaded.list || []).map((t) => ({ id: t.id, kind: t.kind, on: !!S.loaded.on[t.id] })),
    domTracks: Array.from(document.querySelectorAll('#view .track[data-loaded]')).map((e) => e.dataset.loaded),
    cacheKeys: Object.keys(S.loaded.data || {}),
    cachedErr: (cache && cache.error) || null,
    geneCount: genes.length,
    geneNames: genes.map((g) => g.name),
    trackSubText: el ? (el.querySelector('.sub') || {}).textContent : null,
    trackVisible: !!el && el.offsetHeight > 0,
  };
})();
