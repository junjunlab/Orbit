/* 把矢量 SVG 落盘（配合 IGV_DUMP_B64） */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  const vec = await ig.composeVector();
  const svg = window.VEX.toSVG(vec.ops, vec.w, vec.h, { title: 'Orbit' });
  const bytes = new TextEncoder().encode(svg);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return 'data:image/svg+xml;base64,' + btoa(s);
})()
