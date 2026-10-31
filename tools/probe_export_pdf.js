/* 生成 PDF 并以 base64 返回（配合 IGV_DUMP_B64 落盘），同时返回 SVG 头尾做结构检查 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  if (ig.S.panels.length < 2) { ig.setPanelCount(2); await sleep(1000); }
  await sleep(300);

  const cv = ig.composePlot(2);
  const pdf = await ig.pdfFromCanvas(cv, 2);
  const buf = new Uint8Array(await pdf.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const b64 = btoa(s);

  // SVG 结构检查：取前 300 字节 + 尾部 80 字节
  const png = new Uint8Array(await (await new Promise((r) => cv.toBlob(r, 'image/png'))).arrayBuffer());
  const svg = ig.svgFromPng(png, cv.width, cv.height, 'test');
  return b64;
})()
