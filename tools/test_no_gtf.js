(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  for (let i = 0; i < 80 && !window.__igv; i++) await sleep(100);
  out.hasHook = !!window.__igv;
  if (!out.hasHook) return out;

  const wrap = document.getElementById('gtfWrap');
  out.loadedCount = window.__igv.S.loaded.list.length;
  out.wrapHidden = wrap ? wrap.hidden : null;

  // main RefSeq search still works
  const inp = document.getElementById('locus');
  const sug = document.getElementById('suggest');
  inp.value = 'TP53';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(700);
  out.mainSuggestHidden = sug.hidden;
  out.mainHits = sug.children.length;
  out.mainFirst = sug.children[0]
    ? sug.children[0].textContent.replace(/\s+/g, ' ').trim() : null;
  return out;
})()
