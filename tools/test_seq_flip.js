// CDP test: 序列轨道的 Flip strand（同 IGV 序列轨道名字旁的箭头 / 右键 Flip strand）。
// 语义照 IGV：x 轴不变、逐位取互补（不是把序列倒过来），坐标标尺也不动。
// 前置：开发服务器 8799（在 igv_0.2 下起）；cdp.js 会自己拉起无头 Chrome。
const fs = require('fs');
const path = require('path');
const { connect } = require('./cdp');

const PORT = process.env.IGV_TEST_PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
// 400 bp / 1274 px ≈ 0.31 bp/px → 走「色块」模式（不画字母），便于按像素判色
const LOCUS = process.env.IGV_LOCUS || 'chr19:12791400-12791800';
const URL = `${BASE}/?db=hg38&locus=${LOCUS}`;
const SHOT = path.join(__dirname, '_seq_flip_test.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 读序列轨道前若干格的颜色，判断这一格画的是哪个碱基（bar 模式：0.75 alpha 叠白底）
const SAMPLE = `(() => {
  const S = window.__igv.S;
  const cv = document.querySelector('.track[data-track="seq"] .pane[data-p="0"] canvas')
    || document.querySelector('.track[data-track="seq"] canvas');
  const dpr = cv.width / cv.clientWidth;
  const bpp = (S.view.end - S.view.start) / cv.clientWidth;
  const cellW = 1 / bpp;
  const ctx = cv.getContext('2d');
  const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const at = (x, y) => {
    const ix = Math.round(x * dpr), iy = Math.round(y * dpr);
    const i = (iy * cv.width + ix) * 4;
    return [img[i], img[i + 1], img[i + 2], img[i + 3]];
  };
  const PAL = { A: [63, 143, 95], C: [63, 111, 176], G: [184, 128, 47], T: [184, 92, 79], N: [154, 165, 177] };
  // 画布是透明的：getImageData 拿到的是未预乘的原始色（alpha 单独一列），不要自己混白底
  const blend = (c) => c;
  const classify = (rgb) => {
    let best = null, bd = 1e9;
    for (const [b, c] of Object.entries(PAL)) {
      const e = blend(c);
      const d = (e[0] - rgb[0]) ** 2 + (e[1] - rgb[1]) ** 2 + (e[2] - rgb[2]) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    return { base: best, dist: Math.round(Math.sqrt(bd)) };
  };
  const seqStart = S.data.seqStart;
  const out = { seqStart, viewStart: S.view.start, cellW: +cellW.toFixed(2), letters: cellW >= 8, cells: [] };
  // 按「视野坐标」取格：seq 的起点通常比视野左边界还早（接口会带一点 padding）
  const firstBp = S.view.start + Math.ceil(20 * bpp);
  for (let k = 0; k < 24; k++) {
    const bp = firstBp + k;
    const i = bp - seqStart;
    if (i < 0 || i >= (S.data.seq || '').length) continue;
    const x = (bp - S.view.start) / bpp + cellW / 2;
    if (x < 2 || x > cv.clientWidth - 2) continue;
    const c = at(x, 12);
    out.cells.push({ i, bp, rgb: c.slice(0, 3), ...classify(c) });
  }
  out.seq = S.data.seq ? out.cells.map((c) => S.data.seq[c.i]).join('') : null;
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
  const boot = async () => {
    await send('Page.navigate', { url: URL });
    await sleep(600);
    await ev('localStorage.clear(); sessionStorage.clear();');
    await send('Page.navigate', { url: URL });
    for (let i = 0; i < 160; i++) {
      if (await ev('!!(window.__igv && window.__igv.S.asm)')) break;
      await sleep(250);
    }
    for (let i = 0; i < 60; i++) {
      if (await ev('!!(window.__igv.S.data && window.__igv.S.data.seq)')) break;
      await sleep(250);
    }
    await sleep(900);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await boot();

  const COMP = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N' };
  const before = JSON.parse(await ev(SAMPLE));
  const pressed0 = await ev(`document.querySelector('#seqFlip').getAttribute('aria-pressed')`);
  await ev(`document.querySelector('#seqFlip').click()`);
  await sleep(700);
  const after = JSON.parse(await ev(SAMPLE));
  const pressed1 = await ev(`document.querySelector('#seqFlip').getAttribute('aria-pressed')`);
  const state = JSON.parse(await ev(`JSON.stringify({ flip: window.__igv.S.seqFlip,
    prefs: JSON.parse(localStorage.getItem('igvlocal.prefs.v1') || '{}').seqFlip })`));

  // 期望：翻转前画的碱基 = 序列本身；翻转后 = 互补碱基（逐位互补，不是倒序）
  const beforeSeq = before.seq || '';
  const exp = beforeSeq.split('').map((c) => COMP[c] || c);
  const beforeOk = before.cells.filter((c, k) => c.base === beforeSeq[k] && c.dist < 40).length;
  const afterOk = after.cells.filter((c, k) => c.base === exp[k] && c.dist < 40).length;
  const changed = after.cells.filter((c, k) => {
    const b = before.cells[k];
    return b && b.base !== c.base;
  }).length;

  // 重新加载：本程序每次启动都重置偏好（FRESH_EACH_LAUNCH），翻转状态只在本会话有效
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 160; i++) {
    if (await ev('!!(window.__igv && window.__igv.S.asm)')) break;
    await sleep(250);
  }
  await sleep(1200);
  const persisted = await ev(`JSON.stringify({ flip: window.__igv.S.seqFlip,
    pressed: document.querySelector('#seqFlip').getAttribute('aria-pressed') })`);

  const checks = {
    buttonExists: pressed0 === 'false',
    togglesPressed: pressed1 === 'true',
    stateFlip: state.flip === true,
    prefsWritten: state.prefs === true,
    barsMode: before.letters === false && before.cells.length > 12,
    beforeMatchesSeq: beforeOk >= before.cells.length - 2,
    afterMatchesComplement: afterOk >= after.cells.length - 2,
    cellsChanged: changed > 6,
    resetsOnReload: JSON.parse(persisted).flip === false && JSON.parse(persisted).pressed === 'false',
  };

  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(SHOT, Buffer.from(s.result.data, 'base64'));

  console.log('before', JSON.stringify({ seq: before.seq, cellW: before.cellW, cells: before.cells.map((c) => c.base).join('') }));
  console.log('after ', JSON.stringify({ cells: after.cells.map((c) => c.base).join(''), expect: exp.join('') }));
  console.log('dist  ', JSON.stringify({ beforeOk, afterOk, changed, n: before.cells.length,
    d0: before.cells.slice(0, 3).map((c) => [c.base, c.dist, c.rgb]) }));
  console.log('persist', persisted);
  console.log('\nCHECKS:', JSON.stringify(checks));
  const ok = Object.values(checks).every(Boolean);
  console.log('RESULT:', ok ? 'PASS' : 'FAIL');
  await cdp.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
