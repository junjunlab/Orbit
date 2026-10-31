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
  const out = {};

  // 多词输入时联想只针对最后一段
  inp.focus();
  inp.value = 'ACTB, TP5';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(900);
  out.lastTermHits = sug.children.length;
  out.lastTermFirst = sug.children[0]
    ? sug.children[0].querySelector('.n').textContent : null;

  // 回车 → 三个基因分屏（GFF3 轨道）
  inp.value = 'ACTB, TP53, BRCA1';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(3000);

  out.panelCount = S.panels.length;
  out.panels = S.panels.map((P) => `${P.view.chrom}:${P.view.start}-${P.view.end}`);
  out.panelGenes = S.panels.map((P) => P.sel && P.sel.name);
  out.panelTx = S.panels.map((P) => (P.sel && P.sel.tx ? P.sel.tx.length : -1));
  out.panelPrefixed = S.panels.map((P) => {
    const tx = (P.sel && P.sel.tx) || [];
    return tx.filter((t) => /transcript:/i.test(t.name)).length;
  });
  out.toast = document.getElementById('toast').textContent;
  return out;
})()
