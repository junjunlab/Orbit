(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  for (let i = 0; i < 100 && !window.__igv; i++) await sleep(100);
  out.hasHook = !!window.__igv;
  if (!out.hasHook) return out;

  const sel = document.getElementById('gtfTrackSel');
  const inp = document.getElementById('gtfInput');
  const sug = document.getElementById('gtfSuggest');
  const wrap = document.getElementById('gtfWrap');
  out.wrapHidden = wrap ? wrap.hidden : null;
  out.options = sel ? [...sel.options].map((o) => o.value) : [];

  const tid = (out.options.find((v) => /GRCh38\.116/.test(v)) || out.options[0] || '');
  out.tid = tid;
  if (!tid) return out;
  sel.value = tid;
  sel.dispatchEvent(new Event('change', { bubbles: true }));

  // ---- 搜索 ACTB（走真实搜索框）
  inp.value = 'ACTB';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(900);
  out.hits = sug.children.length;
  out.firstHit = sug.children[0]
    ? sug.children[0].textContent.replace(/\s+/g, ' ').trim() : null;
  if (sug.children[0]) sug.children[0].click();
  await sleep(1400);

  const I = window.__igv;
  const S = I.S;
  out.view = [S.view.chrom, S.view.start, S.view.end];
  out.selName = S.sel && S.sel.name;
  out.selTx = S.sel && S.sel.tx ? S.sel.tx.length : -1;
  const tx = (S.sel && S.sel.tx) || [];
  out.txNames = tx.slice(0, 6).map((t) => t.name);
  out.prefixed = tx.filter((t) => /transcript:/i.test(t.name)).length;
  out.withCds = tx.filter((t) => t.cdsEnd > t.cdsStart).length;
  const t0 = tx[0];
  if (t0) {
    out.tx0 = { name: t0.name, cds: [t0.cdsStart, t0.cdsEnd],
                exons: t0.exons.length, exon0: t0.exons[0] };
  }

  // ---- 只展开 ACTB 这一个基因（key = `${tid}|name|strand`）
  const strand = (S.sel && S.sel.strand) || '-';
  const key = `${tid}|ACTB|${strand}`;
  S.loaded.expanded.add(key);
  I.scheduleRender();
  await sleep(1500);

  // ---- 量一下基因轨道当前高度，确认确实展开了
  const cv = document.querySelectorAll('canvas');
  out.canvasCount = cv.length;
  out.expandedKeys = [...S.loaded.expanded];
  out.renderOk = true;
  return out;
})()
