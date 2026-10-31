/* 验证：RefSeq 与导入 GTF 轨道的配色设置（正链/负链/CDS/UTR） */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { steps: [] };
  const log = (k, v) => { out.steps.push([k, v]); };

  // 等注释轨道就绪
  for (let i = 0; i < 60 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);

  const rowsOf = (pop) => [...pop.querySelectorAll('.row .lbl')].map((e) => e.textContent);

  // ---------- 1) RefSeq 弹窗 ----------
  const gGear = document.querySelector('.track[data-track="genes"] .tgear');
  log('refseqGear', !!gGear);
  if (gGear) {
    gGear.click();
    await sleep(200);
    const pop = document.querySelector('#tpop');
    log('refseqPopTitle', pop.querySelector('h5')?.textContent || '');
    log('refseqRows', rowsOf(pop));
    // 点 CDS 行里的红色 chip
    const rows = [...pop.querySelectorAll('.row')];
    const cdsRow = rows.find((r) => r.querySelector('.lbl')?.textContent === 'CDS 颜色');
    const chip = [...(cdsRow?.querySelectorAll('.chip') || [])].find((c) => c.dataset.c === '#a8624f');
    chip?.click();
    await sleep(250);
    log('refseqCdsAfterClick', ig.S.tint.cds);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await sleep(100);
  }

  // ---------- 2) 导入 GTF 轨道 ----------
  const gtf = ig.S.loaded.list.find((t) => t.kind === 'gene');
  log('gtfTrack', gtf ? gtf.id : null);
  const el = gtf && document.querySelector(`.track[data-loaded="${CSS.escape(gtf.id)}"]`);
  log('gtfTrackEl', !!el);
  const lGear = el && el.querySelector('.tgear');
  log('gtfGear', !!lGear);
  if (lGear) {
    lGear.click();
    await sleep(250);
    const pop = document.querySelector('#tpop');
    log('gtfPopTitle', pop.querySelector('h5')?.textContent || '');
    log('gtfRows', rowsOf(pop));
    const rows = [...pop.querySelectorAll('.row')];
    const plusRow = rows.find((r) => r.querySelector('.lbl')?.textContent === '正链颜色');
    const utrRow = rows.find((r) => r.querySelector('.lbl')?.textContent === 'UTR 颜色');
    const pchip = [...(plusRow?.querySelectorAll('.chip') || [])].find((c) => c.dataset.c === '#4f8a6b');
    pchip?.click();
    await sleep(150);
    const uchip = [...(utrRow?.querySelectorAll('.chip') || [])].find((c) => c.dataset.c === '#b08b3e');
    uchip?.click();
    await sleep(250);
    log('gtfOwnTint', ig.S.loaded.tint[gtf.id] || null);
    log('globalTintUntouched', { plus: ig.S.tint.genesPlus, minus: ig.S.tint.genesMinus, utr: ig.S.tint.utr });
    log('resolvedGtf', ig.geneTint(gtf.id));
    log('resolvedRefseq', ig.geneTint(null));
  }

  // ---------- 3) 渲染是否真的变了 ----------
  const canvas = document.querySelector('.track[data-track="genes"] canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = {};
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      const k = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      seen[k] = (seen[k] || 0) + 1;
    }
    out.topColors = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }

  return out;
})()
