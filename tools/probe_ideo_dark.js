/* 深色主题下的染色体示意图（白带 + 灰描边 + 红三角着丝粒） */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  document.body.setAttribute('data-theme', 'dark');
  ig.scheduleRender();
  await sleep(500);
  return { theme: document.body.getAttribute('data-theme'), chrom: ig.S.view.chrom };
})()
