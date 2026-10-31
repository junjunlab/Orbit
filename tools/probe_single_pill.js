/* 单屏快照：确认「位置」行居中 + ruler 右上角保留区间胶囊 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  if (ig.S.panels.length > 1) { ig.setPanelCount(1); await sleep(900); }
  const head = document.querySelector('#paneHead');
  const row = [...document.querySelectorAll('.track')].find(t => (t.textContent || '').trim().startsWith('位置'));
  return {
    panels: ig.S.panels.length,
    paneHeadHidden: head ? head.hasAttribute('hidden') : null,
    locusRowText: row ? row.textContent.trim().slice(0, 60) : null,
  };
})()
