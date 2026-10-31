/* 点第三屏的染色体示意图：只应改变第三屏的位置，第一/二屏不动 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  ig.setPanelCount(3);
  await sleep(1200);
  const loci = [['chr17', 7577638, 7584111], ['chr1', 196636713, 196759476], ['chr19', 31573381, 31583361]];
  for (let i = 0; i < 3; i++) await ig.navigatePanel(i, loci[i][0], loci[i][1], loci[i][2], { force: true });
  await sleep(1500);

  const before = ig.S.panels.map((p) => ({ ...p.view }));
  const cv = document.querySelector('.track[data-track="ideogram"] .pane[data-p="2"] canvas');
  const r = cv.getBoundingClientRect();
  const x = r.left + r.width * 0.25;   // 点在第三屏染色体 1/4 处
  const y = r.top + r.height / 2;
  for (const type of ['mousedown', 'mouseup', 'click']) {
    cv.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
  }
  await sleep(1200);
  const after = ig.S.panels.map((p) => ({ ...p.view }));
  const len = ig.S.asm.chroms['chr19'];
  const expect = Math.round((0.25 * len - (before[2].end - before[2].start) / 2));
  return {
    before, after,
    expectCenter: expect,
    pane3Center: Math.round((after[2].start + after[2].end) / 2),
    pane1Moved: after[0].start !== before[0].start,
    pane2Moved: after[1].start !== before[1].start,
    pane3Chrom: after[2].chrom,
  };
})()
