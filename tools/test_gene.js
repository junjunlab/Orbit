// Verify: (a) selected gene is enclosed in a rectangle, (b) bigWig bars are
// 1px wide and contiguous (no gaps between bars).
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  // wait for bigWig data to render
  let tries = 0;
  while (tries++ < 90) {
    const cs = [...document.querySelectorAll('.track[data-bw] canvas')];
    if (cs.length >= 1 && cs.every((c) => c.width > 0)) break;
    await wait(200);
  }

  // ---------- (a) bar geometry: count empty columns inside the signal span ----------
  const bc = document.querySelector('.track[data-bw] canvas');
  const bctx = bc.getContext('2d');
  const W = bc.width, H = bc.height;
  const px = bctx.getImageData(0, 0, W, H).data;
  // sample a band that avoids the axis labels (top) and the baseline (bottom)
  const bandTop = Math.round(H * 0.35), bandBot = Math.round(H * 0.72);
  const has = new Uint8Array(W);
  for (let x = 0; x < W; x++) {
    for (let y = bandTop; y < bandBot; y++) {
      const i = (y * W + x) * 4;
      if (px[i] < 235 || px[i + 1] < 235 || px[i + 2] < 235) { has[x] = 1; break; }
    }
  }
  let first = -1, last = -1;
  for (let x = 0; x < W; x++) if (has[x]) { if (first < 0) first = x; last = x; }
  let gapCols = 0, span = 0;
  if (first >= 0) {
    for (let x = first; x <= last; x++) { span++; if (!has[x]) gapCols++; }
  }
  out.bars = {
    canvasPx: W,
    signalSpanPx: span,
    emptyColumnsInsideSpan: gapCols,
    gapPct: span ? +(gapCols / span * 100).toFixed(2) : 0,
  };

  // ---------- (b) click a gene -> it must be boxed ----------
  const gc = document.querySelector('.track[data-track="genes"] canvas');
  const gr = gc.getBoundingClientRect();
  const tip = document.getElementById('tip');

  // count accent-coloured (selection stroke) pixels before the click
  const countAccent = () => {
    const c = gc.getContext('2d');
    const d = c.getImageData(0, 0, gc.width, gc.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      // accent #4b5563 -> rgb(75,85,99); allow +-7 per channel
      if (Math.abs(d[i] - 75) < 7 && Math.abs(d[i + 1] - 85) < 7 && Math.abs(d[i + 2] - 99) < 7) n++;
    }
    return n;
  };
  out.accentPixelsBefore = countAccent();

  // sweep the first row until the tooltip reports a gene
  let hitX = -1, hitName = '';
  for (let x = 3; x < gr.width; x += 2) {
    gc.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: gr.left + x, clientY: gr.top + 17,
    }));
    if (!tip.hidden) {
      const m = tip.textContent.match(/([A-Za-z0-9_.\-]+)\s*(→|←)/);
      if (m) { hitX = x; hitName = m[1]; break; }
    }
  }
  out.geneHit = { x: hitX, name: hitName };

  if (hitX >= 0) {
    gc.dispatchEvent(new MouseEvent('click', {
      bubbles: true, clientX: gr.left + hitX, clientY: gr.top + 17,
    }));
    await wait(500);
    out.accentPixelsAfter = countAccent();
    out.infoPanel = (document.getElementById('info').textContent || '').slice(0, 80);
    out.boxDrawn = out.accentPixelsAfter > out.accentPixelsBefore;
  }

  return JSON.stringify(out);
})();
