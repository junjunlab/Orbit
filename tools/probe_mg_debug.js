/* 诊断：多基因输入后 S.panels 状态 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  out.before = { len: ig.S.panels.length, act: ig.S.act, keys: Object.keys(ig.S.panels[0] || {}) };

  const input = document.querySelector('#locus');
  input.value = 'TP53, BRCA1';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(500);
  out.after500 = { len: ig.S.panels.length, act: ig.S.act };
  await sleep(2500);
  out.after3000 = {
    len: ig.S.panels.length,
    act: ig.S.act,
    views: ig.S.panels.map((p) => (p && p.view ? `${p.view.chrom}:${p.view.start}-${p.view.end}` : null)),
    counts: ig.S.panels.map((p) => ((p && p.data && p.data.genes) || []).length),
    toast: (document.querySelector('#toast') || {}).textContent || '',
  };
  // 直接调用函数看是否报错
  try {
    ig.setPanelCount(2);
    out.setPanelCountOk = ig.S.panels.length;
  } catch (e) {
    out.setPanelCountErr = String(e && e.message || e);
  }
  return out;
})()
