/* 复现用户的四屏导出（acbt / myc / jun / jund），可落盘 SVG 或 PDF */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !window.__igv; i++) await sleep(100);
  const ig = window.__igv;
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  ig.setPanelCount(4);
  await sleep(1500);
  const loci = [
    ['chr7', 5524677, 5536494], ['chr8', 127735000, 127746817],
    ['chr1', 58775629, 58787446], ['chr19', 18276858, 18288789],
  ];
  for (let i = 0; i < 4; i++) await ig.navigatePanel(i, ...loci[i], { force: true });
  await sleep(2500);
  const vec = await ig.composeVector();
  if (location.hash === '#svg') {
    const svg = window.VEX.toSVG(vec.ops, vec.w, vec.h, { title: 'split4' });
    const bytes = new TextEncoder().encode(svg);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return 'data:image/svg+xml;base64,' + btoa(s);
  }
  const font = await ig.loadCJKFont();
  const blob = await window.VEX.toPDF(vec.ops, vec.w, vec.h, font, { title: 'split4' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return 'data:application/pdf;base64,' + btoa(s);
})()
