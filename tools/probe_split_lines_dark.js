/* 4 屏 + 深色主题：确认 overlay 竖线在深底上仍然连续且能区分 */
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
  document.querySelector('#btnTheme').click();
  await sleep(1400);
  const view = document.querySelector('#view');
  const ov = view.querySelector(':scope > .split-lines');
  return {
    theme: document.body.dataset.theme,
    panels: window.__igv.S.panels.length,
    lineColor: ov && ov.children.length ? getComputedStyle(ov.children[0]).backgroundColor : null,
    lineH: ov && ov.children.length ? getComputedStyle(ov.children[0]).height : null,
    overlayH: ov ? ov.style.height : null,
    viewH: view.clientHeight, scrollH: view.scrollHeight,
    canvasBg: getComputedStyle(document.body).getPropertyValue('--canvas-bg').trim(),
  };
})()
