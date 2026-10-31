/* 分屏下折叠：ACTB 展开后点 − 收起，并确认 pane1 的 CASC11/MYC 不受影响 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !window.__igv; i++) await sleep(100);
  const ig = window.__igv;
  const S = ig.S;
  for (let i = 0; i < 80 && !(S.data.genes && S.data.genes.length); i++) await sleep(100);
  ig.setPanelCount(2);
  await sleep(1200);
  const loci = [['chr7', 5524570, 5536494], ['chr8', 127735000, 127746817]];
  for (let i = 0; i < 2; i++) await ig.navigatePanel(i, ...loci[i], { force: true });
  await sleep(2500);
  const tid = 'Homo_sapiens.GRCh38.112';
  const t = S.loaded.list.find((x) => x.id === tid);
  const el = document.querySelector('.track[data-loaded="' + tid + '"]');
  const rect = el.querySelector('.track-body').getBoundingClientRect();

  // 先展开 pane0 的 ACTB
  let p0 = (t._placedByPane || {})[0] || [];
  let actb = p0.find((p) => p.g.name === 'ACTB' && p.tgl);
  const key = ig.loadedGeneKey(t, actb.g);
  let box = S.panels[0].ltoggles.find((b) => b.key === key);
  const cv0 = el.querySelectorAll('canvas')[0];
  const click = (b) => cv0.dispatchEvent(new MouseEvent('click', {
    clientX: rect.left + b.x + b.w / 2, clientY: rect.top + b.y + b.h / 2, bubbles: true }));
  click(box);
  await sleep(700);

  p0 = (t._placedByPane || {})[0] || [];
  actb = p0.find((p) => p.g.name === 'ACTB');
  const expandedSpan = actb.span;

  // 再点一次（此时按钮变成了 −，位置可能变了）→ 收起
  box = S.panels[0].ltoggles.find((b) => b.key === key);
  click(box);
  await sleep(700);

  p0 = (t._placedByPane || {})[0] || [];
  actb = p0.find((p) => p.g.name === 'ACTB');
  return {
    expandedSpan,
    collapsedSpan: actb.span,
    collapsed: !ig.isLoadedExpanded(t, actb.g),
    pane0Genes: p0.map((p) => p.g.name).slice(0, 12),
    pane1Genes: ((t._placedByPane || {})[1] || []).map((p) => p.g.name).slice(0, 12),
    qDepth: 0,
  };
})()
