// 导入 FASTA 与内置 RefSeq 序列轨道的碱基是否逐位对齐
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !window.__igv; i++) await sleep(100);
  const I = window.__igv;
  const S = I.S;
  const out = {};

  const cb = document.querySelector('#loadedList .loaded-trk[data-loadedid="aligned_test"] input.on');
  out.checkbox = !!cb;
  if (cb && !cb.checked) { cb.checked = true; cb.onchange({ target: cb }); }
  // 两条序列轨道都用正链，便于逐位比对
  I.setSeqFlip(false);
  if (I.loadedSeqFlipped({ id: 'aligned_test' })) I.setLoadedSeqFlip('aligned_test', false);
  await sleep(600);

  await I.navigate('chr17', 7669570, 7669660, { force: true });
  await sleep(2200);

  const grab = (sel) => {
    const cv = document.querySelector(sel + ' canvas');
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    // 每一列里「彩色墨迹」的像素数（灰阶不算）
    const cols = new Array(cv.width).fill(0);
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx - mn >= 40 && mx > 60) cols[x]++;
      }
    }
    // 找出每段连续墨迹的质心
    const runs = [];
    let s = -1;
    for (let x = 0; x < cv.width; x++) {
      if (cols[x] > 0) { if (s < 0) s = x; }
      else if (s >= 0) { runs.push([s, x - 1]); s = -1; }
    }
    if (s >= 0) runs.push([s, cv.width - 1]);
    return { width: cv.width, dpr: cv.width / cv.getBoundingClientRect().width, runs: runs.slice(0, 14) };
  };

  const ref = grab('.track[data-track="seq"]');
  const lod = grab('.track[data-loaded="aligned_test"]');
  out.refRuns = ref && ref.runs;
  out.lodRuns = lod && lod.runs;

  // 逐位比对第一个字母的中心
  if (ref && lod && ref.runs.length && lod.runs.length) {
    const c = (r) => (r[0] + r[1]) / 2;
    const deltas = [];
    const n = Math.min(ref.runs.length, lod.runs.length);
    for (let i = 0; i < n; i++) deltas.push(+(c(lod.runs[i]) - c(ref.runs[i])).toFixed(2));
    out.centerDeltas = deltas;
    out.maxAbsDelta = Math.max(...deltas.map(Math.abs));
  }
  return out;
})()
