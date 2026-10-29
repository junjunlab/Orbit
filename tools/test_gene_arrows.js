// CDP test: 基因的转录方向必须看得见 —— 方向雪佛龙（画在外显子块之上）+ 3′ 端箭头。
// 回归点：以前 drawChevrons 在外显子之前画，被 CDS(12px)/UTR(7px) 块整块盖掉，
// 单外显子基因（如 JUNB）完全看不到方向；RefSeq 轨道还根本没调 drawStrandArrow。
// 前置：开发服务器 8799（在 igv_0.2 下起）；cdp.js 会自己拉起无头 Chrome。
const fs = require('fs');
const path = require('path');
const { connect } = require('./cdp');

const PORT = process.env.IGV_TEST_PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const SHOT = path.join(__dirname, '_gene_arrows_test.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 在页面里取基因轨道的像素统计：返回 CDS 块里有没有「浅色墨」、末端外侧有没有箭头
const PROBE = (which) => `(() => {
  const { S, geneLayout } = window.__igv;
  const lay = geneLayout();
  const want = ${JSON.stringify(which)};
  const p = lay.placed.find((q) => (want === 'minus' ? q.g.strand === '-' : q.g.strand === '+')
    && q.x2 - q.x1 > 60 && q.x1 > 30 && q.x2 < lay.w - 60 && !q.expanded);
  if (!p) return JSON.stringify({ err: 'no gene' });
  const cv = document.querySelector('.track[data-track="genes"] .pane[data-p="0"] canvas')
    || document.querySelector('.track[data-track="genes"] canvas');
  const dpr = cv.width / cv.clientWidth;
  const bpp = (S.view.end - S.view.start) / cv.clientWidth;
  const xOf = (bp) => (bp - S.view.start) / bpp;
  const ctx = cv.getContext('2d');
  const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const at = (x, y) => {
    const ix = Math.round(x * dpr), iy = Math.round(y * dpr);
    if (ix < 0 || iy < 0 || ix >= cv.width || iy >= cv.height) return null;
    const i = (iy * cv.width + ix) * 4;
    return [img[i], img[i + 1], img[i + 2], img[i + 3]];
  };
  const cy = 6 + p.r * 22 + 11;          // ROW_H = 22
  const tx = p.txl && p.txl[0];
  const cdsX1 = tx ? xOf(tx.cdsStart) : p.x1;
  const cdsX2 = tx ? xOf(tx.cdsEnd) : p.x2;
  // 画布背景是透明的（alpha=0），必须连 alpha 一起判，否则「空」也会被当成墨
  const lightIn = (x1, x2, y0, y1) => {   // 浅色像素（雪佛龙 / 白箭头）计数
    let n = 0;
    for (let x = x1; x <= x2; x++) {
      for (let y = y0; y <= y1; y++) {
        const c = at(x, y);
        if (c && c[3] > 200 && c[0] > 190 && c[1] > 190 && c[2] > 190) n++;
      }
    }
    return n;
  };
  const darkIn = (x1, x2, y0, y1) => {    // 链色像素（#3d4b5c 附近的深色）计数
    let n = 0;
    for (let x = x1; x <= x2; x++) {
      for (let y = y0; y <= y1; y++) {
        const c = at(x, y);
        if (c && c[3] > 200 && c[0] < 130 && c[1] < 140 && c[2] < 160) n++;
      }
    }
    return n;
  };
  const out = {
    name: p.g.name, strand: p.g.strand,
    x1: Math.round(p.x1), x2: Math.round(p.x2), cy,
    cds: [Math.round(cdsX1), Math.round(cdsX2)],
    // 3′ 端外侧 1..6px 应该探出链色箭头
    arrowAt3p: p.g.strand === '-'
      ? darkIn(Math.round(p.x1) - 6, Math.round(p.x1) - 1, cy - 3, cy + 3)
      : darkIn(Math.round(p.x2) + 1, Math.round(p.x2) + 6, cy - 3, cy + 3),
    // 5′ 端外侧不应该有箭头
    arrowAt5p: p.g.strand === '-'
      ? darkIn(Math.round(p.x2) + 1, Math.round(p.x2) + 6, cy - 3, cy + 3)
      : darkIn(Math.round(p.x1) - 6, Math.round(p.x1) - 1, cy - 3, cy + 3),
  };

  // ---- 雪佛龙方向：首个雪佛龙落在 5′ UTR（浅灰块）上，墨色是深色正文色，
  // 三角形的「底边」在哪一侧就能判出朝向：正链底边在左、负链底边在右。
  const darkRow = (y) => {
    const xs = [];
    for (let x = Math.round(p.x1) + 4; x <= Math.round(p.x1) + 24; x++) {
      const c = at(x, y);
      if (c && c[3] > 200 && c[0] < 110 && c[1] < 120 && c[2] < 140) xs.push(x);
    }
    return xs;
  };
  const com = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const top = darkRow(cy - 2), mid = darkRow(cy);
  out.chevronInk = mid.length + top.length;
  // <0 → 底边偏左（正链 ▶）；>0 → 底边偏右（负链 ◀）
  out.chevronBias = (com(top) != null && com(mid) != null) ? +(com(top) - com(mid)).toFixed(2) : null;
  return JSON.stringify(out);
})()`;

async function main() {
  const cdp = await connect();
  const { send } = cdp;
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      console.error('JS ERR', JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return null;
    }
    return r.result.result.value;
  };
  const boot = async (locus) => {
    await send('Page.navigate', { url: `${BASE}/?db=hg38&locus=${locus}` });
    await sleep(600);
    await ev('localStorage.clear(); sessionStorage.clear();');
    await send('Page.navigate', { url: `${BASE}/?db=hg38&locus=${locus}` });
    for (let i = 0; i < 160; i++) {
      if (await ev('!!(window.__igv && window.__igv.S.asm)')) break;
      await sleep(250);
    }
    await sleep(1800);
  };

  await send('Page.enable');
  await send('Runtime.enable');

  // 1) 正链单外显子（JUNB）：用户截图报的那一处
  await boot('chr19:12790884-12794091');
  const plus = JSON.parse(await ev(PROBE('plus')));
  // 2) 负链基因（VAT1）：雪佛龙朝左、箭头在左端
  await boot('chr17:43000000-43060000');
  const minus = JSON.parse(await ev(PROBE('minus')));

  const checks = {
    plusFound: plus && !plus.err && plus.strand === '+',
    plusChevron: plus && plus.chevronInk > 4 && plus.chevronBias < -0.3,  // ▶ 底边在左
    plusArrowAt3p: plus && plus.arrowAt3p > 8,
    plusNoArrowAt5p: plus && plus.arrowAt5p < 4,
    minusFound: minus && !minus.err && minus.strand === '-',
    minusChevron: minus && minus.chevronInk > 4 && minus.chevronBias > 0.3, // ◀ 底边在右
    minusArrowAt3p: minus && minus.arrowAt3p > 4,
    minusNoArrowAt5p: minus && minus.arrowAt5p < 4,
  };

  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(SHOT, Buffer.from(s.result.data, 'base64'));

  console.log('正链 JUNB:', JSON.stringify(plus));
  console.log('负链     :', JSON.stringify(minus));
  console.log('\nCHECKS:', JSON.stringify(checks));
  const ok = Object.values(checks).every(Boolean);
  console.log('RESULT:', ok ? 'PASS' : 'FAIL');
  await cdp.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
