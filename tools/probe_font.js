/* 诊断：字体子集大小 / 压缩结果 / 内容流大小 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  const out = {};
  try {
    const vec = await ig.composeVector();
    const font = await ig.loadCJKFont();
    // 复现 toPDF 里的收集逻辑
    const used = new Set([0]);
    const rev = new Map();
    for (const op of vec.ops) {
      if (op.k !== 'text') continue;
      for (const ch of op.s) { const g = font.gidOf(ch.codePointAt(0)); used.add(g); rev.set(g, ch); }
    }
    out.glyphs = used.size;
    out.fontBytesOrig = font.buf.length;
    out.glyfLen = font.T.glyf.len;
    out.locaLen = font.T.loca.len;
    out.indexToLoc = font.dv.getInt16(font.T.head.off + 50);
    font.usedGids = used;
    const t0 = performance.now();
    const sub = window.VEX.subsetFont(font);
    out.ms = Math.round(performance.now() - t0);
    out.subLen = sub ? sub.length : null;
    out.subHead = sub ? Array.from(sub.slice(0, 16)).map((v) => v.toString(16)).join(' ') : null;
    // 未用字形是不是真的被清空了：比较 loca 总长
    let kept = 0;
    for (let g = 0; g < font.numGlyphs; g++) if (used.has(g)) kept += font.loca[g + 1] - font.loca[g];
    out.keptBytes = kept;
    out.totalGlyf = font.loca[font.numGlyphs];
  } catch (e) {
    out.err = e.message + ' | ' + (e.stack || '').split('\n')[1];
  }
  return out;
})()
