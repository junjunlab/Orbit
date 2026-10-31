/* 截图用：切成 4 屏，看列间竖线是否够明显 */
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
  await sleep(1200);
  const ig = window.__igv;
  // 量一下竖线的实际颜色和位置
  const pane = document.querySelector('#view .track-body.panes > .pane[data-p="1"]');
  const ph = document.querySelectorAll('#paneHeads .ph')[1];
  const cs = (el) => (el ? getComputedStyle(el).borderLeftColor : null);
  return {
    panels: ig.S.panels.length,
    views: ig.S.panels.map((p) => p.view.chrom + ':' + Math.round((p.view.end - p.view.start) / 1000) + 'kb'),
    paneBorder: cs(pane),
    headBorder: cs(ph),
    paneBorderW: pane ? getComputedStyle(pane).borderLeftWidth : null,
  };
})()
