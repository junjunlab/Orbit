/* 矢量导出自检：统计录制到的图元、字体解析结果、SVG/PDF 是否真矢量 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  const out = { vex: typeof window.VEX, ops: {}, err: null };
  try {
    const vec = await ig.composeVector();
    const kinds = {};
    for (const op of vec.ops) kinds[op.k] = (kinds[op.k] || 0) + 1;
    out.ops = kinds;
    out.size = [Math.round(vec.w), Math.round(vec.h)];
    out.total = vec.ops.length;
    out.sampleText = vec.ops.filter((o) => o.k === 'text').slice(0, 6).map((o) => o.s);

    const svg = window.VEX.toSVG(vec.ops, vec.w, vec.h, { title: 't' });
    out.svg = { bytes: svg.length, hasImage: svg.includes('<image'), text: (svg.match(/<text/g) || []).length, path: (svg.match(/<path/g) || []).length };

    const font = await ig.loadCJKFont();
    out.font = font ? { upem: font.unitsPerEm, glyphs: font.numGlyphs, gid染: font.gidOf('染'.codePointAt(0)), gidA: font.gidOf(65) } : null;
    const blob = await window.VEX.toPDF(vec.ops, vec.w, vec.h, font, { title: 't' });
    out.pdf = { bytes: blob.size, type: blob.type };
  } catch (e) {
    out.err = e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n');
  }
  return out;
})()
