/* 量「位置」行与轨道面板的对齐关系 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  if (ig.S.panels.length < 2) { ig.setPanelCount(2); await sleep(900); }
  const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.width)]; };
  const heads = [...document.querySelectorAll('#paneHeads .ph')].map(box);
  const inputs = [...document.querySelectorAll('#paneHeads .ph-in')].map(box);
  const panes = [...document.querySelectorAll('.track[data-track="ruler"] .pane')].map(box);
  const body1 = box(document.querySelector('.track[data-track="ruler"] .track-body'));
  const body2 = box(document.querySelector('#paneHeads'));
  return { heads, inputs, panes, rulerBody: body1, headBody: body2,
    textAlign: getComputedStyle(document.querySelector('#paneHeads .ph-in')).textAlign };
})()
