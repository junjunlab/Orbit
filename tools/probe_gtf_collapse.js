(async () => {
  const ig = window.__igv;
  const S = ig.S;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tid = 'Homo_sapiens.GRCh38.112';
  const t = S.loaded.list.find((x) => x.id === tid);
  for (let i = 0; i < 120 && !(t._placed && t._placed.length); i++) await sleep(100);
  const el = document.querySelector('.track[data-loaded="' + tid + '"]');
  const body = el.querySelector('.track-body');
  const canvas = el.querySelector('canvas');
  const rect = body.getBoundingClientRect();
  const click = (x, y) => canvas.dispatchEvent(new MouseEvent('click', {
    clientX: rect.left + x, clientY: rect.top + y, bubbles: true,
  }));
  const boxOf = (gene) => (S._loadedToggles || []).find((b) => b.key === ig.loadedGeneKey(t, gene));

  const expandedEntry = (t._placed || []).find((p) => p.expanded);
  if (!expandedEntry) return { error: 'nothing expanded', set: [...S.loaded.expanded] };
  const before = { gene: expandedEntry.g.name, span: expandedEntry.span, set: [...S.loaded.expanded] };

  // 1) click the minus toggle -> collapse
  let b = boxOf(expandedEntry.g);
  click(b.x + b.w / 2, b.y + b.h / 2);
  await sleep(450);
  const p1 = (t._placed || []).find((p) => p.g.name === before.gene);
  const afterCollapse = { span: p1 ? p1.span : null, set: [...S.loaded.expanded] };

  // 2) click the plus toggle -> expand again, then click a transcript row
  b = boxOf(p1.g);
  click(b.x + b.w / 2, b.y + b.h / 2);
  await sleep(500);
  const p2 = (t._placed || []).find((p) => p.g.name === before.gene);
  const afterExpand = { span: p2 ? p2.span : null, set: [...S.loaded.expanded] };

  // click the middle of transcript row #2 -> should select the gene
  const cw = canvas.getBoundingClientRect().width;
  const toPx = (bp) => (bp - S.view.start) / ((S.view.end - S.view.start) / cw);
  const tx2 = p2.rows[Math.min(2, p2.rows.length - 1)];
  const rowY = 6 + (p2.r + Math.min(2, p2.rows.length - 1)) * 20 + 10;
  const midX = (toPx(tx2.start) + toPx(tx2.end)) / 2;
  click(midX, rowY);
  await sleep(300);

  return {
    before,
    afterCollapse,
    afterExpand,
    sel: S.sel ? { name: S.sel.name, chrom: S.sel.chrom, strand: S.sel.strand } : null,
    selTrack: S.selTrack,
    infoToggle: (document.querySelector('#info #expandToggle') || {}).textContent || null,
    infoRows: document.querySelectorAll('#info tbody tr').length,
    prefs: (() => { try { return JSON.parse(localStorage.getItem('igvlocal.prefs.v1')).loadedExpanded; } catch (e) { return null; } })(),
  };
})();
