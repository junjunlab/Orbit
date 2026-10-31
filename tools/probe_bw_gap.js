/* 检测接缝 + A/B 复现（旧逻辑 vs 新逻辑，同一 dpr 下对比） */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1200);
  const out = { dpr: window.devicePixelRatio, tracks: [] };
  const near = (v) => v > 200; // 背景/网格线都算浅色

  const canvases = [...document.querySelectorAll('.track[data-bw] canvas')];
  for (const cv of canvases) {
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const img = ctx.getImageData(0, 0, W, H).data;
    const isBg = (i) => img[i + 3] < 40 || (near(img[i]) && near(img[i + 1]) && near(img[i + 2]));

    let row = -1, best = 0;
    for (let y = 0; y < H; y++) {
      let c = 0;
      for (let x = 0; x < W; x++) if (!isBg((y * W + x) * 4)) c++;
      if (c > best) { best = c; row = y; }
    }
    if (row < 0) { out.tracks.push({ id: cv.parentElement.parentElement.dataset.bw, empty: true }); continue; }

    const hist = new Map();
    for (let x = 0; x < W; x++) {
      const i = (row * W + x) * 4;
      if (isBg(i)) continue;
      const k = `${img[i]},${img[i + 1]},${img[i + 2]}`;
      hist.set(k, (hist.get(k) || 0) + 1);
    }
    const modal = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const [mr, mg, mb] = modal.split(',').map(Number);

    let first = -1, last = -1;
    for (let x = 0; x < W; x++) if (!isBg((row * W + x) * 4)) { if (first < 0) first = x; last = x; }
    let seam = 0;
    for (let x = first; x <= last; x++) {
      const i = (row * W + x) * 4;
      if (isBg(i)) continue;
      if (Math.abs(img[i] - mr) + Math.abs(img[i + 1] - mg) + Math.abs(img[i + 2] - mb) > 12) seam++;
    }
    out.tracks.push({
      id: cv.parentElement.parentElement.dataset.bw,
      row, span: last - first + 1, modalColor: modal, seamPx: seam,
    });
  }

  // ---- A/B：同一 dpr 下，旧（CSS 像素取整）vs 新（设备像素取整）----
  const dpr = window.devicePixelRatio || 1;
  function trial(snapDevice) {
    const cv = document.createElement('canvas');
    const cw = 200, chh = 40;
    cv.width = Math.round(cw * dpr); cv.height = Math.round(chh * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#d9433a';
    const n = 40, binW = cw / n;
    const sn = (v) => (snapDevice ? Math.round(v * dpr) / dpr : Math.round(v));
    for (let i = 0; i < n; i++) {
      const x0 = sn(i * binW), x1 = sn((i + 1) * binW);
      c.fillRect(x0, 8, Math.max(snapDevice ? 1 / dpr : 1, x1 - x0), 24);
    }
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    let seam = 0;
    const row = Math.floor(20 * dpr);
    for (let x = 1; x < cv.width - 1; x++) {
      const i = (row * cv.width + x) * 4;
      if (d[i + 3] < 250) { seam++; continue; }            // 半透明 = 未铺满
      const diff = Math.abs(d[i] - 0xd9) + Math.abs(d[i + 1] - 0x43) + Math.abs(d[i + 2] - 0x3a);
      if (diff > 12) seam++;
    }
    return seam;
  }
  out.abTest = { oldCssSnap: trial(false), newDeviceSnap: trial(true), width: Math.round(200 * dpr) };
  return out;
})()
