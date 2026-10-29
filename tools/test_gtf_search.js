(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  for (let i = 0; i < 80 && !window.__igv; i++) await sleep(100);
  out.hasHook = !!window.__igv;
  if (!out.hasHook) return out;

  const wrap = document.getElementById('gtfWrap');
  const sel = document.getElementById('gtfTrackSel');
  const inp = document.getElementById('gtfInput');
  const sug = document.getElementById('gtfSuggest');
  out.wrapExists = !!wrap;
  out.wrapHidden = wrap ? wrap.hidden : null;
  out.optionCount = sel ? sel.options.length : -1;
  out.options = sel ? [...sel.options].map((o) => o.value + ':' + o.textContent) : [];

  // type a substring -> debounce 130ms + fetch
  inp.value = 'gene';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(600);
  out.suggestHidden = sug.hidden;
  out.hitCount = sug.children.length;
  out.firstHit = sug.children[0]
    ? sug.children[0].textContent.replace(/\s+/g, ' ').trim() : null;

  // click first suggestion
  if (sug.children[0]) sug.children[0].click();
  await sleep(700);
  const S = window.__igv.S;
  out.viewChrom = S.view.chrom;
  out.viewStart = S.view.start;
  out.viewEnd = S.view.end;
  out.selTrack = S.selTrack;
  out.selName = S.sel && S.sel.name;
  out.selStart = S.sel && S.sel.start;
  out.selEnd = S.sel && S.sel.end;
  out.selTx = S.sel && S.sel.tx ? S.sel.tx.length : -1;
  out.inputValue = inp.value;
  out.suggestHiddenAfter = sug.hidden;

  // exact-match, lowercase should still find (case-insensitive)
  inp.value = 'gene2';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(500);
  out.lowerHitCount = sug.children.length;
  out.lowerFirst = sug.children[0]
    ? sug.children[0].textContent.replace(/\s+/g, ' ').trim() : null;

  // restrict to a specific track
  sel.value = 'demo_genes';
  inp.value = 'gene';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(500);
  out.trackScopedHits = sug.children.length;

  // no match
  inp.value = 'zzzznope';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(500);
  out.noMatchHidden = sug.hidden;

  return out;
})()
