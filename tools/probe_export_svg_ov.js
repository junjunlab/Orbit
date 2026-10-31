/* 复现 PDF 导出：把 composeVector() 结果转 SVG 返回（配合 IGV_DUMP_B64 落盘）
   用法：
     IGV_DUMP_B64=/tmp/ov.svg node tools/cdp_shot.js http://127.0.0.1:8799/ /tmp/ov.png tools/probe_export_svg_ov.js
*/
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !(ig.S.data && ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  ig.S.expLabels = true;
  if (ig.S.panels.length > 1) { ig.setPanelCount(1); await sleep(900); }
  // 折叠态总览
  ig.S.overviewExpanded = false;
  ig.renderInfo();
  await sleep(400);
  const vec = await ig.composeVector();
  const svg = VEX.toSVG(vec.ops, vec.w, vec.h, { title: 'ov' });
  // 同时把概览相关 op 抽出来便于核对（深蓝 accent 圆角条 + 红框）
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
})()
