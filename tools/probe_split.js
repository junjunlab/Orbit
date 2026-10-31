/* 验证多基因分屏：3 屏各自独立导航、各自渲染 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { steps: [] };
  const log = (k, v) => out.steps.push([k, v]);
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);

  log('panelsBefore', ig.S.panels.length);

  // 切到 3 屏
  ig.setPanelCount(3);
  for (let i = 0; i < 40 && document.querySelectorAll('.pane[data-p="2"]').length === 0; i++) await sleep(100);
  await sleep(600);
  log('panelsAfter', ig.S.panels.length);
  log('paneEls', document.querySelectorAll('#view .pane[data-p="0"]').length);
  log('heads', [...document.querySelectorAll('#paneHeads .ph-in')].map((i) => i.value));

  // 分别导航到三个基因
  await ig.goPanel(1, 'BRCA1');
  await ig.goPanel(2, 'MYC');
  await sleep(1500);

  log('views', ig.S.panels.map((p) => `${p.view.chrom}:${p.view.start}-${p.view.end}`));
  log('geneCounts', ig.S.panels.map((p) => (p.data.genes || []).length));
  log('firstGenes', ig.S.panels.map((p) => ((p.data.genes || [])[0] || {}).name || null));
  log('headsAfter', [...document.querySelectorAll('#paneHeads .ph-in')].map((i) => i.value));
  log('active', ig.S.act);

  // 每屏的 RefSeq canvas 是否画了东西（非空像素比例）
  const canvases = [...document.querySelectorAll('.track[data-track="genes"] .pane canvas')];
  log('genCanvases', canvases.length);
  out.paneInk = canvases.map((cv) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20) ink++;
    return { w: cv.width, h: cv.height, ink };
  });

  // 在屏 3 上滚轮缩放，验证只影响该屏
  const p3 = document.querySelector('.track[data-track="genes"] .pane[data-p="2"]');
  const r = p3.getBoundingClientRect();
  const before = ig.S.panels.map((p) => p.view.start);
  p3.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: r.left + r.width / 2, clientY: r.top + 6 }));
  await sleep(900);
  log('zoomOnlyPane3', before.map((v, i) => v !== ig.S.panels[i].view.start));
  log('activeAfterWheel', ig.S.act);
  return out;
})()
