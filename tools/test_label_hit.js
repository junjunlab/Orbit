// 回归：标签避让之后「看到的名字」还点得中吗
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 100 && !window.__igv; i++) await sleep(100);
  const I = window.__igv;
  const S = I.S;
  const out = {};

  await I.navigate('chr17', 7650000, 7700000, { force: true });
  await sleep(1200);

  const cv = document.querySelector('.track[data-track="genes"] canvas');
  if (!cv) { out.error = 'no genes canvas'; return out; }
  const rect = cv.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  out.canvas = { w: Math.round(w), h: Math.round(h) };

  // 沿第一行扫描：找一个能命中基因的 x（这里就是「看得见的名字」所在的位置）
  const rowY = 6 + 20 / 2; // ROW_H/2 + padding
  let hitX = -1;
  let hitName = null;
  for (let x = 2; x < w - 2; x += 3) {
    const g = I.geneAt(x, rowY);
    if (g) { hitX = x; hitName = g.name; break; }
  }
  out.firstHitAtRow0 = hitName;

  // 扫描整块画布，确认任何返回非空的位置点击后都能选中同一个基因
  const checks = [];
  for (let y = 2; y < h - 2; y += 6) {
    for (let x = 2; x < w - 2; x += 11) {
      const g = I.geneAt(x, y);
      if (!g) continue;
      checks.push({ x, y, name: g.name });
      if (checks.length >= 12) break;
    }
    if (checks.length >= 12) break;
  }
  out.sampled = checks.length;

  let ok = 0;
  let bad = [];
  for (const c of checks) {
    const cx = rect.left + c.x;
    const cy = rect.top + c.y;
    cv.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window,
    }));
    await sleep(120);
    const got = S.sel && S.sel.name;
    if (got === c.name) ok++;
    else bad.push(`${c.name} -> ${got}`);
  }
  out.clickOk = ok;
  out.clickBad = bad.slice(0, 5);
  out.pass = bad.length === 0;
  return out;
})()
