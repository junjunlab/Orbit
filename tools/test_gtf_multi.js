(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  for (let i = 0; i < 80 && !window.__igv; i++) await sleep(100);
  if (!window.__igv) { out.error = 'no hook'; return out; }
  const S = window.__igv.S;
  const inp = document.getElementById('gtfInput');
  const sug = document.getElementById('gtfSuggest');

  // 多词输入时，联想只针对最后一段
  inp.focus();
  inp.value = 'GENE1, GENE';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(600);
  out.lastTermHits = sug.children.length;
  out.lastTermFirst = sug.children[0]
    ? sug.children[0].querySelector('.n').textContent : null;

  // 回车 → 两个基因分屏
  inp.value = 'GENE1, GENE2';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(1800);
  out.panelCount = S.panels.length;
  out.panels = S.panels.map((P) => `${P.view.chrom}:${P.view.start}-${P.view.end}`);
  out.toast = document.getElementById('toast').textContent;
  out.suggestHidden = sug.hidden;

  // 三个词（含一个不存在的）→ 只对找到的分屏，并提示未找到
  inp.value = 'GENE1, GENE2, NOPE_XYZ';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(1800);
  out.panelCount2 = S.panels.length;
  out.toast2 = document.getElementById('toast').textContent;
  return out;
})()
