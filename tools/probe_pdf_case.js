/* 三屏 acbt/myc/jund 的矢量 PDF（配合 IGV_DUMP_B64） */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !window.__igv; i++) await sleep(100);
  const ig = window.__igv;
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  ig.setPanelCount(3);
  await sleep(1200);
  const loci = [['chr7', 5524570, 5534023], ['chr8', 127732434, 127745951], ['chr1', 58777791, 58787047]];
  for (let i = 0; i < 3; i++) await ig.navigatePanel(i, ...loci[i], { force: true });
  await sleep(2000);
  const vec = await ig.composeVector();
  const font = await ig.loadCJKFont();
  const blob = await window.VEX.toPDF(vec.ops, vec.w, vec.h, font, { title: 'case' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return 'data:application/pdf;base64,' + btoa(s);
})()
