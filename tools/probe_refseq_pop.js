/* 仅打开 RefSeq 轨道设置面板并保持打开，用于截图 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 60 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  document.querySelector('.track[data-track="genes"] .tgear').click();
  await sleep(250);
  const pop = document.querySelector('#tpop');
  return {
    title: pop.querySelector('h5')?.textContent,
    rows: [...pop.querySelectorAll('.row .lbl')].map((e) => e.textContent),
    chipsPerRow: [...pop.querySelectorAll('.row')].map((r) => r.querySelectorAll('.chip').length),
  };
})()
