/* 验证：色块高亮跟随 + 重置按钮 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  for (let i = 0; i < 60 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);

  const rowsIn = (pop) => [...pop.querySelectorAll('.row')];
  const rowByLabel = (pop, t) => rowsIn(pop).find((r) => r.querySelector('.lbl')?.textContent === t);
  const selOf = (row) => row?.querySelector('.chip.sel')?.dataset.c || null;

  // --- RefSeq：CDS 选黑色，检查高亮是否切换 ---
  document.querySelector('.track[data-track="genes"] .tgear').click();
  await sleep(200);
  let pop = document.querySelector('#tpop');
  let cdsRow = rowByLabel(pop, 'CDS 颜色');
  out.beforeSel = selOf(cdsRow);
  [...cdsRow.querySelectorAll('.chip')].find((c) => c.dataset.c === '#a8624f').click();
  await sleep(150);
  out.afterSel = selOf(cdsRow);
  out.tintCds = ig.S.tint.cds;

  // --- 重置 ---
  [...pop.querySelectorAll('.foot .btn')].find((b) => b.textContent === '重置').click();
  await sleep(200);
  out.afterReset = { cds: ig.S.tint.cds, plus: ig.S.tint.genesPlus, utr: ig.S.tint.utr };

  // --- 导入 GTF：设 own 颜色后重置，应回落到全局 ---
  const gtf = ig.S.loaded.list.find((t) => t.kind === 'gene');
  const el = gtf && document.querySelector(`.track[data-loaded="${CSS.escape(gtf.id)}"]`);
  el.querySelector('.tgear').click();
  await sleep(200);
  pop = document.querySelector('#tpop');
  const plusRow = rowByLabel(pop, '正链颜色');
  [...plusRow.querySelectorAll('.chip')].find((c) => c.dataset.c === '#8a5a72').click();
  await sleep(120);
  out.gtfOwn = JSON.parse(JSON.stringify(ig.S.loaded.tint[gtf.id] || null));
  [...pop.querySelectorAll('.foot .btn')].find((b) => b.textContent === '重置').click();
  await sleep(200);
  out.gtfOwnAfterReset = ig.S.loaded.tint[gtf.id] || null;
  out.gtfResolvedAfterReset = ig.geneTint(gtf.id);
  out.globalStillDefault = { plus: ig.S.tint.genesPlus, cds: ig.S.tint.cds, utr: ig.S.tint.utr };
  return out;
})()
