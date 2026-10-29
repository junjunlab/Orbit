/* 截图：Find motif 对话框 + 已生成的正负链轨道 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 160 && !(window.__igv && window.__igv.S.asm); i++) await sleep(100);
  const ig = window.__igv;
  ig.addMotifTrack('CAG', '+', 'CAG');
  ig.addMotifTrack('CAG', '-', 'CAG Negative');
  ig.ensureMotifTrackEls();
  ig.scheduleRender();
  await sleep(1200);
  document.querySelector('#btnMotif').click();
  await sleep(300);
  const p = document.querySelector('#motifPattern');
  p.value = 'TATAAA(A){3,}';
  p.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);
  const btn = document.querySelector('#btnMotif').getBoundingClientRect();
  return { motifBtn: { x: Math.round(btn.x), w: Math.round(btn.width), text: document.querySelector('#btnMotif').textContent.trim() } };
})()
