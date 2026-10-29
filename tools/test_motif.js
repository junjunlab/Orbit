// CDP test: Find motif（对齐 IGV 的 Tools → Find Motif）
// 前置：开发服务器 8799（在 igv_0.2 下起）；cdp.js 会自己拉起无头 Chrome。
const fs = require('fs');
const path = require('path');
const { connect } = require('./cdp');

const PORT = process.env.IGV_TEST_PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/?db=hg38&locus=chr7:5525000-5530000`;
const SHOT = path.join(__dirname, '_motif.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cdp = await connect();
  const { send } = cdp;
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      console.error('JS ERR', JSON.stringify(r.result.exceptionDetails).slice(0, 500));
      return null;
    }
    return r.result.result.value;
  };
  const waitBoot = async () => {
    for (let i = 0; i < 160; i++) {
      if (await ev('!!(window.__igv && window.__igv.S.asm)')) return true;
      await sleep(250);
    }
    return false;
  };
  const rows = () => ev(`JSON.stringify([...document.querySelectorAll('#view .track[data-motif]')].map((r) => ({
    id: r.dataset.motif,
    name: (r.querySelector('.nm') || {}).textContent || '',
    sub: (r.querySelector('.sub') || {}).textContent || '',
    h: Math.round(r.getBoundingClientRect().height),
    panes: r.querySelectorAll('.pane').length,
  })))`);
  // 统计某行 canvas 里的“命中色”像素
  const painted = (id, rgb) => ev(`(() => {
    const c = document.querySelector('.track[data-motif="${id}"] .pane[data-p="0"] canvas');
    if (!c) return -1;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 40 && Math.abs(d[i] - ${rgb[0]}) < 26
        && Math.abs(d[i + 1] - ${rgb[1]}) < 26 && Math.abs(d[i + 2] - ${rgb[2]}) < 26) n++;
    }
    return n;
  })()`);
  const waitSub = async (pred, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const r = JSON.parse(await rows());
      if (r.length && pred(r)) return r;
      await sleep(150);
    }
    return JSON.parse(await rows());
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(700);
  await ev('localStorage.clear(); sessionStorage.clear();');
  await send('Page.navigate', { url: URL });
  if (!await waitBoot()) { console.error('boot timeout'); await cdp.close(); process.exit(1); }
  await sleep(1500);

  const checks = {};

  // 1) 打开对话框，输入 pattern → 轨道名自动跟随
  await ev(`document.querySelector('#btnMotif').click()`);
  await sleep(300);
  checks.dialogOpens = await ev(`!document.querySelector('#motifDlg').hidden`);
  await ev(`(() => {
    const p = document.querySelector('#motifPattern');
    p.value = 'CAG';
    p.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  const names = JSON.parse(await ev(`JSON.stringify({
    pos: document.querySelector('#motifPos').value,
    neg: document.querySelector('#motifNeg').value
  })`));
  checks.autoNames = names.pos === 'CAG' && names.neg === 'CAG Negative';

  // 2) 确定 → 两条轨道
  await ev(`document.querySelector('#motifOk').click()`);
  await sleep(400);
  let r = await waitSub((x) => x.every((t) => /个位点/.test(t.sub)));
  checks.twoTracks = r.length === 2 && r[0].name === 'CAG' && r[1].name === 'CAG Negative';
  checks.labelsHaveCounts = r.every((t) => /个位点/.test(t.sub));
  const counts = r.map((t) => Number((t.sub.match(/(\d+)/) || [0, 0])[1]));

  // 3) canvas 上真的画出了东西（+ 链蓝、- 链红）
  const posPx = await painted(r[0].id, [31, 111, 178]);
  const negPx = await painted(r[1].id, [192, 57, 43]);
  checks.posPainted = counts[0] > 0 && posPx > 20;
  checks.negPainted = counts[1] > 0 && negPx > 20;

  // 4) IUPAC 简并碱基
  await ev(`document.querySelector('#btnMotif').click()`);
  await sleep(250);
  await ev(`(() => {
    const p = document.querySelector('#motifPattern');
    p.value = 'AARNNR';
    p.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(120);
  await ev(`document.querySelector('#motifOk').click()`);
  await sleep(300);
  const r4 = await waitSub((x) => x.length === 4 && x.slice(2).every((t) => /个位点/.test(t.sub)));
  checks.iupacWorks = r4.length === 4 && /个位点/.test(r4[2].sub) && r4[2].name === 'AARNNR';
  const iupacCount = Number((r4[2].sub.match(/(\d+)/) || [0, 0])[1]);
  checks.iupacFindsHits = iupacCount > 0 && iupacCount !== counts[0];

  // 5) 非法 pattern 报错、不加轨道
  await ev(`document.querySelector('#btnMotif').click()`);
  await sleep(250);
  await ev(`(() => {
    const p = document.querySelector('#motifPattern');
    p.value = 'ACGTX';
    p.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await ev(`document.querySelector('#motifOk').click()`);
  await sleep(300);
  const errShown = await ev(`(() => {
    const e = document.querySelector('#motifErr');
    return !e.hidden && /不是合法的查找模式/.test(e.textContent);
  })()`);
  const stillFour = JSON.parse(await rows()).length === 4;
  checks.invalidRejected = errShown && stillFour;
  await ev(`document.querySelector('#motifCancel').click()`);
  await sleep(200);

  // 6) 视野 > 1 Mb 时轨道隐藏（同 IGV 的 visibilityWindow）
  await ev(`window.__igv.navigate('chr7', 0, 159345973)`);
  await sleep(1200);
  const wide = JSON.parse(await rows());
  checks.hidesWhenWide = wide.every((t) => /视野过大/.test(t.sub));
  await ev(`window.__igv.navigate('chr7', 5525000, 5530000)`);
  await sleep(1200);

  // 7) 分屏：motif 轨道也跟着分
  await ev(`window.__igv.setPanelCount(2)`);
  await sleep(1500);
  const split = JSON.parse(await rows());
  checks.splitAware = split.every((t) => t.panes === 2);

  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(SHOT, Buffer.from(s.result.data, 'base64'));

  // 8) 移除按钮
  await ev(`window.__igv.setPanelCount(1)`);
  await sleep(900);
  await ev(`document.querySelector('.track[data-motif] .mx').click()`);
  await sleep(500);
  checks.removable = JSON.parse(await rows()).length === 3;

  console.log('counts  :', JSON.stringify(counts), 'iupac', iupacCount);
  console.log('rows    :', JSON.stringify(r));
  console.log('\nCHECKS:', JSON.stringify(checks));
  const ok = Object.values(checks).every(Boolean);
  console.log('RESULT:', ok ? 'PASS' : 'FAIL');
  await cdp.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
