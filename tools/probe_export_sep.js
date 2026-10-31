/* 检查导出图里的分屏竖线：找出「贯穿整幅高度」的深色列。
   4 屏应该有 3 条这样的列，且颜色接近纯黑。 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 160 && !(ig.S && ig.S.asm); i++) await sleep(100);
  const input = document.querySelector('#locus');
  input.focus();
  input.value = 'ACTB, NCAPD2, JUND, JUNB';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  for (let i = 0; i < 80 && ig.S.panels.length < 4; i++) await sleep(150);
  await sleep(1000);

  const cv = ig.composePlot(2);
  const W = cv.width, H = cv.height;
  const img = cv.getContext('2d').getImageData(0, 0, W, H).data;
  const hits = [];
  for (let x = 0; x < W; x++) {
    let n = 0, r = 0, g = 0, b = 0;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      if (img[i] < 40 && img[i + 1] < 40 && img[i + 2] < 40 && img[i + 3] > 200) {
        n++; r += img[i]; g += img[i + 1]; b += img[i + 2];
      }
    }
    if (n > H * 0.55) hits.push({ x, pct: +(n / H * 100).toFixed(1),
      rgb: [Math.round(r / n), Math.round(g / n), Math.round(b / n)] });
  }
  // 相邻列合并成一条线
  const lines = [];
  for (const h of hits) {
    const last = lines[lines.length - 1];
    if (last && h.x - last.x1 <= 1) { last.x1 = h.x; last.w++; }
    else lines.push({ x0: h.x, x1: h.x, w: 1, pct: h.pct, rgb: h.rgb });
  }
  return { panels: ig.S.panels.length, W, H, lines };
})()
