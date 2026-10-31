/* 校验染色体示意图：整条染色体（未放大）与放大后（红色三层视图框）的观感
   URL 带 #dump 时返回整条染色体的 ideogram 位图（配合 IGV_DUMP_B64 落盘），
   否则只返回采样到的配色统计。                                                */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  const dump = location.hash === '#dump';

  const info = {
    bands: (ig.S.bands['chr7'] || []).length,
    acen: (ig.S.bands['chr7'] || []).filter((b) => b[3] === 'acen').map((b) => [b[2], b[0], b[1]]),
  };
  await ig.navigate('chr7', 0, ig.S.asm.chroms['chr7']);
  await sleep(800);
  const cv0 = document.querySelector('.track[data-track="ideogram"] canvas');
  if (dump) return cv0.toDataURL('image/png');

  // 放大到 p 臂一段，看红色视图框
  await ig.navigate('chr7', 54000000, 56000000);
  await sleep(800);
  const cv = document.querySelector('.track[data-track="ideogram"] canvas');
  const ctx = cv.getContext('2d');
  const seen = new Set();
  for (let x = 0; x < cv.width; x += 2) {
    for (const y of [Math.round(cv.height * 0.3), Math.round(cv.height * 0.5)]) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      seen.add(`${d[0]},${d[1]},${d[2]}`);
    }
  }
  const r = cv.getBoundingClientRect();
  return { ...info, canvasCss: [Math.round(r.width), Math.round(r.height)], colors: [...seen].sort() };
})()
