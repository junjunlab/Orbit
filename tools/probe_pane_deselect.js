/* 演示：三屏 → 点第 1 屏等于取消全部选中（灰色块与顶部强调线都消失） */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  if (ig.S.panels.length < 3) { ig.setPanelCount(3); await sleep(1200); }
  await sleep(400);

  const body = document.querySelector('.track[data-track="gc"] .pane[data-p="0"]');
  const r = body.getBoundingClientRect();
  const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  body.dispatchEvent(new MouseEvent('mousedown', opt));
  window.dispatchEvent(new MouseEvent('mouseup', opt));
  body.dispatchEvent(new MouseEvent('click', opt));
  await sleep(200);

  return {
    selPane: ig.S.selPane,
    phAct: [...document.querySelectorAll('#paneHeads .ph')].map((p) => p.classList.contains('act')),
    paneAct: [...document.querySelectorAll('.track[data-track="ruler"] .pane')].map((p) => p.classList.contains('act')),
    status: document.querySelector('#stLocus').textContent.trim(),
  };
})()
