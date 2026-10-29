(() => {
  const ig = window.__igv;
  if (!ig) return { error: 'no __igv' };
  const S = ig.S;
  return {
    asm: S.asm && S.asm.id,
    bwList: S.bw.list.map((t) => ({ id: t.id, format: t.format, on: !!S.bw.on[t.id], align: S.bw.on[t.id + '::align'] })),
    loaded: S.loaded.list.map((t) => ({ id: t.id, kind: t.kind, on: S.loaded.on[t.id] })),
    order: [...document.querySelectorAll('#view .track')].map((e) => e.dataset.tkey).filter(Boolean),
  };
})();
