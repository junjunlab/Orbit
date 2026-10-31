/* 分屏后：位置行居中 + ruler 右上角不再重复画区间胶囊 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  if (ig.S.panels.length < 3) { ig.setPanelCount(3); await sleep(1200); }

  // 采样第 1 个面板 ruler 右上角区域，统计非背景像素（胶囊底色/文字都会污染这块）
  const ruler = document.querySelector('.track[data-track="ruler"] canvas');
  const dpr = ig.S.dpr || 1;
  const ctx = ruler.getContext('2d');
  const W = ruler.width, H = ruler.height;
  const zoneW = Math.round(200 * dpr), zoneH = Math.round(18 * dpr);
  const img = ctx.getImageData(W - zoneW, 0, zoneW, zoneH).data;
  const seen = new Map();
  for (let i = 0; i < img.length; i += 4) {
    const k = `${img[i]},${img[i + 1]},${img[i + 2]}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const top = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  return {
    panels: ig.S.panels.length,
    paneCountFn: typeof ig.paneCount,
    aligned: getComputedStyle(document.querySelector('#paneHeads .ph-in')).textAlign,
    rulerTopColors: top,
    canvasW: W, dpr,
  };
})()
