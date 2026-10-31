/* 4 屏：确认「全基因组」轨道也分屏，每屏画自己那条染色体 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 160 && !(window.__igv && window.__igv.S.asm); i++) await sleep(100);
  const input = document.querySelector('#locus');
  input.focus();
  input.value = 'ACTB, NCAPD2, JUND, JUNB';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  for (let i = 0; i < 80 && window.__igv.S.panels.length < 4; i++) await sleep(150);
  await sleep(1600);

  const row = document.querySelector('.track[data-track="overview"]');
  const panes = [...row.querySelectorAll('.pane')];
  return {
    panels: window.__igv.S.panels.map((p) => p.view.chrom),
    overviewPanes: panes.length,
    canvasW: panes.map((p) => {
      const c = p.querySelector('canvas');
      return c ? Math.round(c.getBoundingClientRect().width) : 0;
    }),
    paneW: panes.map((p) => Math.round(p.getBoundingClientRect().width)),
    rowH: Math.round(row.getBoundingClientRect().height),
  };
})()
