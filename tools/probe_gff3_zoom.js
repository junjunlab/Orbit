(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 100 && !window.__igv; i++) await sleep(100);
  const I = window.__igv;
  const S = I.S;
  const tid = 'Homo_sapiens.GRCh38.116.chr';
  const sel = document.getElementById('gtfTrackSel');
  sel.value = tid;
  sel.dispatchEvent(new Event('change', { bubbles: true }));

  // 先搜索一次，让轨道与基因被选中
  const inp = document.getElementById('gtfInput');
  const sug = document.getElementById('gtfSuggest');
  inp.value = 'ACTB';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(900);
  if (sug.children[0]) sug.children[0].click();
  await sleep(1200);

  S.loaded.expanded.add(`${tid}|ACTB|-`);
  // 缩到 5' 端第一个外显子：5526300-5529000（UTR 细 / CDS 粗一眼能分）
  I.navigate('chr7', 5526300, 5529000, { force: true });
  I.scheduleRender();
  await sleep(1800);

  const out = { view: [S.view.chrom, S.view.start, S.view.end], bpPerPx: (S.view.end - S.view.start) / 900 };
  const tx = (S.sel && S.sel.tx) || [];
  out.selName = S.sel && S.sel.name;
  out.txCount = tx.length;
  out.prefixed = tx.filter((t) => /transcript:/i.test(t.name)).length;
  out.withCds = tx.filter((t) => t.cdsEnd > t.cdsStart).length;
  const t0 = tx[0];
  if (t0) {
    out.tx0 = { name: t0.name, cds: [t0.cdsStart, t0.cdsEnd], exons: t0.exons };
    // 第一个外显子里 UTR 段长度 / CDS 段长度
    const ex = t0.exons[0];
    if (ex) {
      const utr = Math.max(0, Math.min(ex[1], t0.cdsStart) - ex[0]);
      out.exon0 = { exon: ex, utrBp: utr, cdsBp: Math.max(0, ex[1] - Math.max(ex[0], t0.cdsStart)) };
    }
  }
  return out;
})()
