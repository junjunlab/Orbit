(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 100 && !window.__igv; i++) await sleep(100);
  const I = window.__igv;
  const S = I.S;
  const sel = document.getElementById('gtfTrackSel');
  const inp = document.getElementById('gtfInput');
  const sug = document.getElementById('gtfSuggest');
  const tid = 'Homo_sapiens.GRCh38.116.chr';
  sel.value = tid;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  inp.value = 'ACTB';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(900);
  if (sug.children[0]) sug.children[0].click();
  await sleep(1400);
  S.loaded.expanded.add(`${tid}|ACTB|-`);
  I.scheduleRender();
  await sleep(1500);

  // 从轨道对象里拿放置结果
  const out = { view: [S.view.chrom, S.view.start, S.view.end], rows: [] };
  const t = (S.loaded.list || []).find((x) => x.id === tid);
  out.hasTrackObj = !!t;
  const by = (t && t._placedByPane) || {};
  const pid = S.act;
  const placed = by[pid] || by[Object.keys(by)[0]] || [];
  out.placedCount = placed.length;
  for (const p of placed) {
    out.rows.push({
      name: p.g.name, start: p.g.start, end: p.g.end, r: p.r,
      span: p.span, expanded: !!p.expanded,
      tgl: p.tgl ? { x: Math.round(p.tgl.x), left: !!p.tgl.left } : null,
      labels: (p.labels || []).map((s) => ({ x: Math.round(s.x), tw: Math.round(s.tw), cy: Math.round(s.cy) })),
    });
  }
  return out;
})()
