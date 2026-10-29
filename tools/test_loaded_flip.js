// 导入 FASTA 轨道的 Flip strand：点按钮前后，首个碱基的颜色应从 A(绿) 变成 T(红)
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !window.__igv; i++) await sleep(100);
  const I = window.__igv;
  const S = I.S;
  const out = {};

  // 启动时导入轨道默认是关的（loadLoadedTracks({fresh:true})），先勾上
  const cb = document.querySelector('#loadedList .loaded-trk[data-loadedid="flip_test"] input.on');
  out.checkbox = !!cb;
  if (cb && !cb.checked) { cb.checked = true; cb.onchange({ target: cb }); }
  await sleep(800);

  await I.navigate('chr17', 0, 150, { force: true });
  await sleep(2000);

  const el = document.querySelector('.track[data-loaded="flip_test"]');
  out.trackFound = !!el;
  if (!el) return out;
  const btn = el.querySelector('.sflip[data-seqflip]');
  out.hasFlipBtn = !!btn;
  if (!btn) return out;
  out.btnVisible = getComputedStyle(btn).opacity;
  out.pressed0 = btn.getAttribute('aria-pressed');

  const cv = el.querySelector('canvas');
  const ctx = cv.getContext('2d');

  // 取左侧若干个碱基格子里出现最多的「非灰」颜色
  const sample = () => {
    const w = cv.width;
    const h = cv.height;
    const d = ctx.getImageData(0, 0, Math.min(w, 400), h).data;
    const tally = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a < 200) continue;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max - min < 40) continue;      // 灰阶（背景/文字）跳过
      const k = `${r},${g},${b}`;
      tally.set(k, (tally.get(k) || 0) + 1);
    }
    return [...tally.entries()].sort((p, q) => q[1] - p[1]).slice(0, 3);
  };

  out.before = sample();
  out.subBefore = el.querySelector('.sub') ? el.querySelector('.sub').textContent : null;

  btn.click();
  await sleep(1200);

  out.pressed1 = btn.getAttribute('aria-pressed');
  out.flippedFlag = I.loadedSeqFlipped(S.loaded.list.find((t) => t.id === 'flip_test'));
  out.after = sample();
  out.subAfter = el.querySelector('.sub') ? el.querySelector('.sub').textContent : null;

  // 再点一次回到正链
  btn.click();
  await sleep(1000);
  out.pressed2 = btn.getAttribute('aria-pressed');
  out.back = sample();
  out.subBack = el.querySelector('.sub') ? el.querySelector('.sub').textContent : null;

  return out;
})()
