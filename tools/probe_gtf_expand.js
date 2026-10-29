(async () => {
  const ig = window.__igv;
  if (!ig) return { error: 'no __igv' };
  const S = ig.S;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tid = 'Homo_sapiens.GRCh38.112';
  const t = S.loaded.list.find((x) => x.id === tid);
  if (!t) return { error: 'track missing', list: S.loaded.list.map((x) => x.id) };

  for (let i = 0; i < 120 && !(t._placed && t._placed.length); i++) await sleep(100);
  if (!(t._placed && t._placed.length)) {
    return { error: 'track data not ready', list: S.loaded.list.map((x) => x.id), cacheKeys: Object.keys(S.loaded.data) };
  }
  const el = document.querySelector('.track[data-loaded="' + tid + '"]');
  const canvas = el && el.querySelector('canvas');
  const body = el && el.querySelector('.track-body');

  const snap = () => ({
    canvasH: canvas ? canvas.getBoundingClientRect().height : null,
    toggles: (S._loadedToggles || []).filter((b) => b.track === tid).length,
    expanded: [...S.loaded.expanded].length,
    rows: (t._placed || []).map((p) => ({ gene: p.g.name, span: p.span, row: p.r, txs: p.txl.length })),
    labels: (t._placed || []).reduce((n, p) => n + p.labels.length, 0),
  });

  const before = snap();
  const multi = (t._placed || []).filter((p) => p.span === 1 && p.tgl);
  if (!multi.length) {
    return {
      error: 'no collapsed multi-tx gene',
      before,
      raw: (t._placed || []).map((p) => ({ gene: p.g.name, span: p.span, tgl: !!p.tgl, txs: p.txl.length })),
      expandedSet: [...S.loaded.expanded],
    };
  }

  // real click on the toggle box of the gene with most transcripts
  const target = multi.sort((a, b) => b.txl.length - a.txl.length)[0];
  const box = (S._loadedToggles || []).find((b) => b.key === ig.loadedGeneKey(t, target.g));
  const rect = body.getBoundingClientRect();
  canvas.dispatchEvent(new MouseEvent('click', {
    clientX: rect.left + box.x + box.w / 2,
    clientY: rect.top + box.y + box.h / 2,
    bubbles: true,
  }));
  await sleep(500);

  const after = snap();
  const ps = (t._placed || []).find((p) => p.g.name === target.g.name);

  // strand: sample pixels where the 3' arrowhead sits (plus strand -> right end)
  let arrowPixels = null;
  if (canvas) {
    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    const ctx = canvas.getContext('2d');
    const rowY = 6 + ps.r * 20 + 10;
    const xEnd = Math.min(canvas.width / dpr - 3, (ps.g.end - S.view.start) / ((S.view.end - S.view.start) / (canvas.width / dpr)));
    const px = Math.round(xEnd * dpr);
    const py = Math.round(rowY * dpr);
    const d = ctx.getImageData(Math.max(0, px - 10), Math.max(0, py - 8), 22, 16).data;
    let colored = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) colored++;
    arrowPixels = colored;
  }

  return {
    gene: target.g.name,
    strand: target.g.strand,
    txs: target.txl.length,
    before,
    after,
    expandedSpan: ps ? ps.span : null,
    arrowPixels,
    infoHasExpandLink: !!document.querySelector('#info #expandToggle'),
    infoText: (document.querySelector('#info #expandToggle') || {}).textContent || null,
    tipHint: 'ok',
  };
})();
