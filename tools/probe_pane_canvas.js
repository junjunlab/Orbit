/* 检查分屏下 ruler canvas 的绘制覆盖是否完整（有无未填充的透明区） */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  ig.setPanelCount(3); await sleep(1300);

  const t = document.querySelector('.track[data-track="ruler"]');
  const canvases = [...t.querySelectorAll('canvas')];
  const out = canvases.slice(0, 3).map((c, i) => {
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0, trans = 0;
    for (let p = 3; p < d.length; p += 4) { if (d[p] > 0) opaque++; else trans++; }
    // 找最后一个不透明像素的水平位置
    let lastX = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = c.width - 1; x >= 0; x--) {
        if (d[(y * c.width + x) * 4 + 3] > 0) { if (x > lastX) lastX = x; break; }
      }
    }
    const box = c.getBoundingClientRect();
    return { i, w: c.width, h: c.height, cssW: Math.round(box.width), opaque, trans, lastOpaqueX: lastX, dpr: ig.S.dpr };
  });
  return { count: canvases.length, out };
})()
