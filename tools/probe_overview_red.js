/* 3 屏：看「全基因组」里的视野指示条是否已变成红色 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 160 && !(window.__igv && window.__igv.S.asm); i++) await sleep(100);
  const ig = window.__igv;
  ig.setPanelCount(3);
  await sleep(1200);
  ig.navigatePanel(0, 'chr7', 5525000, 5530000);
  ig.navigatePanel(1, 'chr12', 6534000, 6540000);
  ig.navigatePanel(2, 'chr19', 13130000, 13135000);
  ig.scheduleRender();
  await sleep(1500);
  if (window.__DARK__) { document.querySelector('#btnTheme').click(); await sleep(1200); }
  const c = document.querySelector('.track[data-track="overview"] .pane[data-p="0"] canvas');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, Math.min(c.height, 200)).data;
  const reds = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 200 && d[i] > 150 && d[i + 1] < 110 && d[i + 2] < 120) {
      const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
      reds.set(k, (reds.get(k) || 0) + 1);
    }
  }
  return { theme: document.body.dataset.theme, redPixels: [...reds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3) };
})()
