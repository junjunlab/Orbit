/* 分屏下导入 GTF 的展开/折叠：点第二屏某基因的 + 号，看是否生效 */
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
  if (!t) return { error: 'no track', list: S.loaded.list.map((x) => x.id) };

  // 当前 _placed/_loadedToggles 是哪个 pane 的？看 pane 0 的 canvas 上有没有 + 号
  const el = document.querySelector('.track[data-loaded="' + tid + '"]');
  const canvases = el.querySelectorAll('canvas');
  const toggles = (S._loadedToggles || []).filter((b) => b.track === tid);
  const placed = t._placed || [];
  const multi = placed.filter((p) => p.tgl && p.span === 1);
  return {
    canvases: canvases.length,
    placedCount: placed.length,
    toggles: toggles.length,
    multiGenes: multi.map((p) => p.g.name).slice(0, 10),
    expanded: [...S.loaded.expanded].slice(0, 5),
    actPane: S.act,
  };
})()
