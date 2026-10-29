/* 深色主题下把 ideogram 画布单独落盘（配合 IGV_DUMP_B64） */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  document.body.setAttribute('data-theme', 'dark');
  ig.scheduleRender();
  await sleep(600);
  await ig.navigate('chr7', 54000000, 56000000);
  await sleep(800);
  return document.querySelector('.track[data-track="ideogram"] canvas').toDataURL('image/png');
})()
