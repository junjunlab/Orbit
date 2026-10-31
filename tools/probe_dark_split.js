/* 深色主题下分屏 + 位置行居中检查 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  document.body.setAttribute('data-theme', 'dark');
  ig.setPanelCount(2); await sleep(1300);
  const inp = document.querySelector('#paneHeads .ph-in');
  const cs = getComputedStyle(inp);
  return {
    panels: ig.S.panels.length,
    theme: document.body.getAttribute('data-theme'),
    textAlign: cs.textAlign,
    color: cs.color,
    bg: getComputedStyle(document.querySelector('.phs')).backgroundColor,
    heads: [...document.querySelectorAll('#paneHeads .ph-in')].map(e => e.value),
  };
})()
