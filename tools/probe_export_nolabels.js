/* 关掉「包含左侧轨道名」后，矢量里不应再有左侧标签列的文字/灰底 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  const withL = await ig.composeVector();
  const w1 = Math.round(withL.w);
  ig.S.expLabels = false;
  await sleep(200);
  const noL = await ig.composeVector();
  const labels = ['染色体', '标尺', '序列', '全基因组'];
  const leftTexts = noL.ops.filter((o) => o.k === 'text' && o.x < 12).map((o) => o.s);
  ig.S.expLabels = true;
  await sleep(200);
  await ig.composeVector();   // 复原
  return {
    wWithLabels: w1, wWithout: Math.round(noL.w), narrower: Math.round(noL.w) < w1,
    leftTexts, stillHasLabels: leftTexts.some((s) => labels.includes(s)),
    opsWith: withL.ops.length, opsWithout: noL.ops.length,
  };
})()
