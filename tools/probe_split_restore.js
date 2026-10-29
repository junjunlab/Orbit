/* 检查刷新后是否恢复上次的分屏布局 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1500);
  const n = ig.S.panels.length;
  const out = {
    panels: n,
    views: ig.S.panels.map((p) => `${p.view.chrom}:${p.view.start}-${p.view.end}`),
    panesRendered: document.querySelectorAll('#view .pane[data-p="0"]').length,
    headInputs: [...document.querySelectorAll('#paneHeads .ph-in')].map((i) => i.value),
    geneCounts: ig.S.panels.map((p) => (p.data.genes || []).length),
  };
  if (n > 1) {
    const cv = [...document.querySelectorAll('.track[data-track="genes"] .pane canvas')];
    out.inkPerPane = cv.map((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let k = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 20) k++;
      return k;
    });
  }
  return out;
})()
