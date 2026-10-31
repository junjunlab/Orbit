(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 100 && !window.__igv; i++) await sleep(100);
  const I = window.__igv;
  const S = I.S;
  const tid = 'Homo_sapiens.GRCh38.116.chr';
  const sel = document.getElementById('gtfTrackSel');
  sel.value = tid;
  sel.dispatchEvent(new Event('change', { bubbles: true }));

  const inp = document.getElementById('gtfInput');
  const sug = document.getElementById('gtfSuggest');
  inp.value = 'ACTB';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(900);
  if (sug.children[0]) sug.children[0].click();
  await sleep(1600);

  // 不展开，保持默认（收起）状态
  const out = { view: [S.view.chrom, S.view.start, S.view.end] };
  out.expanded = [...S.loaded.expanded];
  const tx = (S.sel && S.sel.tx) || [];
  out.selName = S.sel && S.sel.name;
  out.txCount = tx.length;
  out.prefixed = tx.filter((t) => /transcript:/i.test(t.name)).length;
  out.withCds = tx.filter((t) => t.cdsEnd > t.cdsStart).length;
  return out;
})()
