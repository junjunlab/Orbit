/* 分屏下：点 pane 0 的 ACTB + 号展开、再点收起 */
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
  const body = el.querySelector('.track-body');

  const p0 = (t._placedByPane || {})[0] || [];
  const actb = p0.find((p) => p.g.name === 'ACTB' && p.tgl);
  if (!actb) return { error: 'no ACTB toggle in pane0', p0: p0.map((p) => p.g.name).slice(0,10) };

  const key = ig.loadedGeneKey(t, actb.g);
  const box = S.panels[0].ltoggles.find((b) => b.key === key);
  if (!box) return { error: 'no toggle box for pane0 ACTB', ltoggles0: S.panels[0].ltoggles.map(b=>b.key).slice(0,10) };

  const rect = body.getBoundingClientRect();
  const click = () => {
    // 点 pane 0 的 + 号：canvas 0 的左上 + box
    const cv0 = el.querySelectorAll('canvas')[0];
    cv0.dispatchEvent(new MouseEvent('click', {
      clientX: rect.left + box.x + box.w / 2,
      clientY: rect.top + box.y + box.h / 2,
      bubbles: true,
    }));
  };
  const before = ig.isLoadedExpanded(t, actb.g);
  click();
  await sleep(600);
  const after = ig.isLoadedExpanded(t, actb.g);
  const p0a = (t._placedByPane || {})[0] || [];
  const actbAfter = p0a.find((p) => p.g.name === 'ACTB');
  return {
    before, after,
    spanAfter: actbAfter ? actbAfter.span : null,
    pane0Genes: p0a.map((p) => p.g.name).slice(0, 12),
    pane1Genes: ((t._placedByPane || {})[1] || []).map((p) => p.g.name).slice(0, 12),
  };
})()
