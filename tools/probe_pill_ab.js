/* A/B：单屏时 ruler 右上角应有区间胶囊（accent 色），分屏后应消失 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);

  const sample = () => {
    const ruler = document.querySelector('.track[data-track="ruler"] canvas');
    const dpr = ig.S.dpr || 1;
    const ctx = ruler.getContext('2d');
    const zoneW = Math.round(200 * dpr), zoneH = Math.round(18 * dpr);
    const img = ctx.getImageData(ruler.width - zoneW, 0, zoneW, zoneH).data;
    const m = new Map();
    for (let i = 0; i < img.length; i += 4) {
      const k = `${img[i]},${img[i + 1]},${img[i + 2]}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => k + ' x' + n);
  };

  // 采集 accent 实际色值，作为「胶囊存在」的判据
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

  ig.setPanelCount(1); await sleep(900);
  const single = sample();
  const singleAccent = { accent, colors: single };

  ig.setPanelCount(3); await sleep(1200);
  const split = sample();

  return { accent, singlePane: single, splitPanes: split };
})()
