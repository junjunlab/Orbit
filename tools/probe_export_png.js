/* 把导出拼图（PNG）以 base64 返回，配合 IGV_DUMP_B64 落盘检查 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  if (ig.S.panels.length < 3) { ig.setPanelCount(3); await sleep(1200); }
  await sleep(400);
  const cv = ig.composePlot(2);
  return cv.toDataURL('image/png');
})()
