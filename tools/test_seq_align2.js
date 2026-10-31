// 用「墨迹列剖面」互相关，量两条序列轨道的水平偏移（应接近 0）
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !window.__igv; i++) await sleep(100);
  const I = window.__igv;
  const out = {};

  const cb = document.querySelector('#loadedList .loaded-trk[data-loadedid="aligned_test"] input.on');
  if (cb && !cb.checked) { cb.checked = true; cb.onchange({ target: cb }); }
  I.setSeqFlip(false);
  if (I.loadedSeqFlipped({ id: 'aligned_test' })) I.setLoadedSeqFlip('aligned_test', false);
  await sleep(600);
  await I.navigate('chr17', 7669570, 7669660, { force: true });
  await sleep(2200);

  // 只取字母所在的横向窄带，避免标尺/底部说明干扰
  const profile = (sel, y0, y1) => {
    const cv = document.querySelector(sel + ' canvas');
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    const band = ctx.getImageData(0, Math.round(y0 * cv.height), cv.width,
      Math.max(1, Math.round((y1 - y0) * cv.height))).data;
    const bw = cv.width;
    const bh = Math.round((y1 - y0) * cv.height);
    const prof = new Array(bw).fill(0);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const i = (y * bw + x) * 4;
        const r = band[i], g = band[i + 1], b = band[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        // 只认饱和的字母色，浅色底条（alpha 0.13）不算
        if (mx - mn >= 60 && mx > 100) prof[x]++;
      }
    }
    return { prof, w: bw };
  };

  // RefSeq：字母带在顶部（top=8, barH=10），画布 34/62 高
  const ref = profile('.track[data-track="seq"]', 0.10, 0.34);
  const lod = profile('.track[data-loaded="aligned_test"]', 0.15, 0.85);
  if (!ref || !lod) { out.error = 'no canvas'; return out; }

  const score = (shift) => {
    let s = 0;
    for (let x = 0; x < ref.w; x++) {
      const y = x + shift;
      if (y < 0 || y >= lod.w) continue;
      s += ref.prof[x] * lod.prof[y];
    }
    return s;
  };
  let best = 0;
  let bestS = -1;
  for (let sh = -40; sh <= 40; sh++) {
    const s = score(sh);
    if (s > bestS) { bestS = s; best = sh; }
  }
  out.bestShiftDevicePx = best;
  out.dpr = lod.w / document.querySelector('.track[data-loaded="aligned_test"] canvas').getBoundingClientRect().width;
  out.bestShiftCssPx = +(best / out.dpr).toFixed(2);
  out.inkCols = {
    ref: ref.prof.filter((v) => v > 0).length,
    loaded: lod.prof.filter((v) => v > 0).length,
  };
  // 参考：一个碱基格宽
  out.cellWDevice = +(lod.w / ((I.S.view.end - I.S.view.start))).toFixed(2);
  return out;
})()
