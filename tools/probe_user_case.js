/* 复现用户截图的三屏状态（acbt / myc / jund），导出 SVG 落盘 + 页面截图 */
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
  const svg = window.VEX.toSVG(vec.ops, vec.w, vec.h, { title: 'case' });
  const bytes = new TextEncoder().encode(svg);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  window.__caseInfo = {
    w: Math.round(vec.w), h: Math.round(vec.h), ops: vec.ops.length,
    rows: [...document.querySelectorAll('#view .track:not([hidden])')].map((t) => {
      const b = t.querySelector('.track-body').getBoundingClientRect();
      return { track: t.dataset.track || 'loaded', top: Math.round(b.top), left: Math.round(b.left), h: Math.round(b.height) };
    }),
  };
  return 'data:image/svg+xml;base64,' + btoa(s);
})()
