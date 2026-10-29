/* 验证搜索框输入多个基因 → 自动分屏 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);

  const input = document.querySelector('#locus');
  const type = async (text) => {
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(350);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(1800);
  };

  await type('TP53, BRCA1');
  out.two = {
    panels: ig.S.panels.length,
    views: ig.S.panels.map((p) => `${p.view.chrom}:${Math.round((p.view.end - p.view.start) / 1000)}kb`),
    counts: ig.S.panels.map((p) => (p.data.genes || []).length),
    heads: [...document.querySelectorAll('#paneHeads .ph-in')].map((i) => i.value),
    hasP53: (ig.S.panels[0].data.genes || []).some((g) => g.name === 'TP53'),
    hasBrca1: (ig.S.panels[1].data.genes || []).some((g) => g.name === 'BRCA1'),
  };

  await type('TP53, BRCA1, MYC');
  out.three = {
    panels: ig.S.panels.length,
    views: ig.S.panels.map((p) => `${p.view.chrom}:${Math.round((p.view.end - p.view.start) / 1000)}kb`),
    counts: ig.S.panels.map((p) => (p.data.genes || []).length),
  };

  // 混合写法：基因 + 坐标
  await type('EGFR, chr8:127,730,000-127,750,000');
  out.mixed = {
    panels: ig.S.panels.length,
    views: ig.S.panels.map((p) => `${p.view.chrom}:${p.view.start}-${p.view.end}`),
    counts: ig.S.panels.map((p) => (p.data.genes || []).length),
  };

  // 单个基因仍走原来的单屏逻辑
  await type('KRAS');
  out.single = { panels: ig.S.panels.length, view: ig.S.panels[0].view,
    hasKras: (ig.S.panels[0].data.genes || []).some((g) => g.name === 'KRAS') };

  // 空格分隔也支持
  await type('EGFR MYC');
  out.space = { panels: ig.S.panels.length,
    views: ig.S.panels.map((p) => `${p.view.chrom}:${Math.round((p.view.end - p.view.start) / 1000)}kb`) };
  return out;
})()
