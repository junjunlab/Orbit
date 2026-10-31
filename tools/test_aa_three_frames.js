/* 验证：三行氨基酸（3 个读码框）+ flip 后按互补链翻译
 * 做法：从画布里逐碱基取终止密码子（红色）的位置，换算回 bp，
 *      与页面自己按同一套规则算出的期望值逐条比对。
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !window.__igv; i++) await sleep(100);
  const I = window.__igv;
  const S = I.S;

  I.setTransTable(1);
  I.setSeqTrans(true);
  I.setSeqFlip(false);
  await I.navigate('chr7', 5527700, 5527810, { force: true });
  await sleep(1800);

  const cv = document.querySelector('.track[data-track="seq"] canvas');
  const rect = cv.getBoundingClientRect();
  const dpr = cv.width / rect.width;
  const g = cv.getContext('2d');
  const seq = S.data.seq;
  const s0 = S.data.seqStart ?? S.data.range.start;
  const code = I.geneticCode(1);
  const COMP = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N' };
  const pxAt = (bp) => ((bp - S.view.start) / (S.view.end - S.view.start)) * rect.width * dpr;

  const codonAt = (cs, flip) => {
    const at = (p) => {
      const i = p - s0;
      if (i < 0 || i >= seq.length) return 'N';
      const c = seq[i].toUpperCase();
      return flip ? (COMP[c] || 'N') : c;
    };
    return flip ? at(cs + 2) + at(cs + 1) + at(cs) : at(cs) + at(cs + 1) + at(cs + 2);
  };
  const expectStops = (flip) => {
    const lo = Math.floor(S.view.start) - 3;
    const hi = Math.ceil(S.view.end) + 3;
    const out = [];
    for (let f = 0; f < 3; f++) {
      const list = [];
      for (let cs = Math.floor(s0 / 3) * 3 + f - 3; cs < s0 + seq.length + 3; cs += 3) {
        if (cs < lo || cs > hi) continue;
        const aa = code.aa[codonAt(cs, flip)] || 'X';
        if (aa === '*') list.push(cs);
      }
      out.push(list);
    }
    return out;
  };

  const isRed = (r, g2, b) => r > 170 && g2 < 110 && b < 110;
  const observedStops = () => {
    const res = [];
    for (let f = 0; f < 3; f++) {
      const y = Math.round((24 + 14 * f) * dpr);
      const row = g.getImageData(0, y, cv.width, 1).data;
      // 一个格子内只要有红像素就算红（字母/虚线会在格子中间打洞，不能单点取样）
      const cellRed = (bp) => {
        const x0 = Math.round(pxAt(bp));
        const x1 = Math.round(pxAt(bp + 1));
        for (let x = Math.max(0, x0 + 1); x < Math.min(cv.width, x1 - 1); x++) {
          const i = x * 4;
          if (isRed(row[i], row[i + 1], row[i + 2])) return true;
        }
        return false;
      };
      const runs = [];
      let s = null;
      for (let bp = Math.floor(S.view.start); bp <= Math.ceil(S.view.end); bp++) {
        const red = cellRed(bp);
        if (red && s === null) s = bp;
        else if (!red && s !== null) { runs.push([s, bp - 1]); s = null; }
      }
      if (s !== null) runs.push([s, Math.ceil(S.view.end)]);
      res.push(runs.filter(([a, b]) => b - a >= 2).map(([a]) => a));
    }
    return res;
  };

  const near = (a, b) => Math.abs(a - b) <= 2;
  const cmp = (exp, got) => exp.every((e) => got.some((v) => near(e, v)))
    && got.every((v) => exp.some((e) => near(e, v)));

  const out = { canvasH: +(cv.height / dpr).toFixed(1), frames: [] };
  for (const flip of [false, true]) {
    I.setSeqFlip(flip);
    await sleep(900);
    const exp = expectStops(flip);
    const got = observedStops();
    out.frames.push({ flip, expect: exp, got, ok: [0, 1, 2].every((i) => cmp(exp[i], got[i])) });
  }
  I.setSeqFlip(false);
  return out;
})()
