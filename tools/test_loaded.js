(() => {
  const ig = window.__igv;
  if (!ig) return { error: 'no __igv', title: document.title };
  const S = ig.S;
  return {
    asm: S.asm && S.asm.id,
    view: { chrom: S.view.chrom, start: S.view.start, end: S.view.end },
    loadedList: (S.loaded.list || []).map((t) => ({ id: t.id, kind: t.kind, format: t.format, on: S.loaded.on[t.id] })),
    domTracks: Array.from(document.querySelectorAll('#view .track[data-loaded]')).map((e) => e.dataset.loaded),
    bwList: (S.bw.list || []).map((t) => ({ id: t.id, loaded: !!t.loaded })),
    bwSecHidden: document.querySelector('#bwSec').hidden,
    loadedSecHidden: document.querySelector('#loadedSec').hidden,
    hasImportBtn: !!document.querySelector('#btnImport'),
    hasFileInput: !!document.querySelector('#fileInput'),
    importedData: Object.keys(S.loaded.data || {}),
    geneTrackText: (document.querySelector('.track[data-loaded="demo_genes"] .sub') || {}).textContent || null,
  };
})();
