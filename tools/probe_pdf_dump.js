/* 把矢量 PDF 落盘（配合 IGV_DUMP_B64），URL 带 #split3 时先切三屏 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  if (location.hash === '#split3') {
    ig.setPanelCount(3);
    await sleep(1200);
    const loci = [['chr17', 7577638, 7584111], ['chr1', 196636713, 196759476], ['chr19', 31573381, 31583361]];
    for (let i = 0; i < 3; i++) await ig.navigatePanel(i, loci[i][0], loci[i][1], loci[i][2], { force: true });
    await sleep(1500);
  }
  const vec = await ig.composeVector();
  const font = await ig.loadCJKFont();
  const blob = await window.VEX.toPDF(vec.ops, vec.w, vec.h, font, { title: 'Orbit' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return 'data:application/pdf;base64,' + btoa(s);
})()
