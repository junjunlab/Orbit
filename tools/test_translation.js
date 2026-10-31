// 氨基酸翻译：密码表正确性 + 翻译行是否真的画出来
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !window.__igv; i++) await sleep(100);
  const I = window.__igv;
  const S = I.S;
  const out = {};

  // ---- 1. 标准密码表 64 个密码子逐一核对（独立副本）
  const B = ['T', 'C', 'A', 'G'];
  const keys = [];
  for (const a of B) for (const b of B) for (const c of B) keys.push(a + b + c);
  const STD = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
  const c1 = I.geneticCode(1);
  let bad = [];
  keys.forEach((k, i) => { if (c1.aa[k] !== STD[i]) bad.push(k + ':' + c1.aa[k] + '/' + STD[i]); });
  out.standardBad = bad;
  out.standardOk = bad.length === 0;

  // ---- 2. 几张表的已知差异
  out.tables = I.GENETIC_TABLES.length;
  const chk = (id, codon, want) => {
    const got = I.geneticCode(id).aa[codon];
    return got === want ? true : `${id}:${codon} ${got}!=${want}`;
  };
  out.diffChecks = [
    chk(2, 'TGA', 'W'), chk(2, 'AGA', '*'), chk(2, 'ATA', 'M'),
    chk(3, 'CTA', 'T'), chk(3, 'TGA', 'W'),
    chk(5, 'AGA', 'S'), chk(6, 'TAA', 'Q'), chk(9, 'AAA', 'N'),
    chk(11, 'TGA', '*'), chk(12, 'CTG', 'S'), chk(33, 'TAG', 'L'),
  ].filter((x) => x !== true);

  // ---- 3. 打开翻译，看翻译行有没有画出来
  await I.navigate('chr7', 5527950, 5528050, { force: true });
  await sleep(1500);
  const cv = document.querySelector('.track[data-track="seq"] canvas');
  const h0 = cv.getBoundingClientRect().height;

  I.setSeqTrans(true);
  await sleep(1200);
  const h1 = cv.getBoundingClientRect().height;
  out.heightBefore = h0;
  out.heightAfter = h1;
  out.grew = +(h1 - h0).toFixed(1);

  // 翻译带里应出现红（终止）/绿（ATG）或条纹
  const dpr = cv.width / cv.getBoundingClientRect().width;
  const y0 = Math.round(17 * dpr);
  const y1 = Math.round(34 * dpr);
  const d = cv.getContext('2d').getImageData(0, y0, cv.width, Math.max(1, y1 - y0)).data;
  let red = 0, green = 0, ink = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 150 && g < 110 && b < 110) red++;
    else if (g > 120 && r < 120 && b < 120) green++;
    if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && r < 240) ink++;
  }
  out.band = { red, green, ink };

  // ---- 4. 切表后重画（表 1 -> 表 2）
  I.setTransTable(2);
  await sleep(900);
  out.tableAfter = S.trans.table;
  const btn = document.querySelector('#seqTrans');
  out.pressed = btn.getAttribute('aria-pressed');

  // ---- 5. 弹层能打开
  btn.click();
  await sleep(300);
  const pop = document.getElementById('transPop');
  out.popOpen = !pop.hidden;
  out.popOptions = pop.querySelectorAll('#transTable option').length;
  out.popChecked = pop.querySelector('#transOn').checked;
  return out;
})()
