// CDP test: 「全基因组」总览也要跟着分屏 —— 每屏一条、点击只跳它自己那一屏。
const fs = require('fs');
const path = require('path');
const { connect } = require('./cdp');

const PORT = process.env.IGV_TEST_PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/?db=hg38&locus=chr7:5525000-5530000`;
const SHOT = path.join(__dirname, '_split_overview_test.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const waitBoot = async () => {
    for (let i = 0; i < 160; i++) {
      if (await ev('!!(window.__igv && window.__igv.S.asm)')) return true;
      await sleep(250);
    }
    return false;
  };
  const state = () => ev(`(() => {
    const ig = window.__igv;
    const row = document.querySelector('.track[data-track="overview"]');
    const panes = [...row.querySelectorAll('.pane')];
    return JSON.stringify({
      panels: ig.S.panels.map((p) => p.view.chrom + ':' + p.view.start),
      paneCount: panes.length,
      paneW: panes.map((p) => Math.round(p.getBoundingClientRect().width)),
      canvasW: panes.map((p) => {
        const c = p.querySelector('canvas');
        return c ? Math.round(c.getBoundingClientRect().width) : 0;
      }),
      // 总览里每屏都画了自己的染色体：canvas 宽 > 0 且互不相同的高度没意义，改看像素非空
      painted: panes.map((p) => {
        const c = p.querySelector('canvas');
        if (!c) return 0;
        const g = c.getContext('2d');
        const d = g.getImageData(0, 0, c.width, Math.min(c.height, 200)).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        return n;
      }),
    });
  })()`);
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(700);
  await ev('localStorage.clear(); sessionStorage.clear();');
  await send('Page.navigate', { url: URL });
  if (!await waitBoot()) { console.error('boot timeout'); await cdp.close(); process.exit(1); }
  await sleep(1500);

  // 3 屏：chr7 / chr12 / chr19
  await ev(`(() => {
    const ig = window.__igv;
    ig.setPanelCount(3);
    return true;
  })()`);
  await sleep(1800);
  await ev(`(() => {
    const ig = window.__igv;
    ig.navigatePanel(0, 'chr7', 5525000, 5530000);
    ig.navigatePanel(1, 'chr12', 6534000, 6540000);
    ig.navigatePanel(2, 'chr19', 13130000, 13135000);
    ig.scheduleRender();
    return true;
  })()`);
  await sleep(1500);

  const g = JSON.parse(await state());
  console.log('3 屏 :', JSON.stringify(g));

  const checks = {};
  checks.panesMatch = g.paneCount === 3;
  checks.canvasFullWidth = g.paneW.every((w, i) => Math.abs(w - g.canvasW[i]) <= 2);
  checks.allPainted = g.painted.every((n) => n > 500);

  // 折叠态下没有 25 行可点，先展开全览（用户也是先点 ▾ 再点染色体）
  await ev(`(() => { const b = document.querySelector('#ovToggle'); if (b) b.click(); return true; })()`);
  await sleep(900);

  // 点第 2 屏总览里的 chr19 行 → 只有第 2 屏跳到 chr19
  const geo = JSON.parse(await ev(`(() => {
    const row = document.querySelector('.track[data-track="overview"]');
    const p = row.querySelector('.pane[data-p="1"]').getBoundingClientRect();
    const rows = [...row.querySelectorAll('.pane[data-p="1"] canvas')];
    return JSON.stringify({ left: Math.round(p.left), top: Math.round(p.top),
                            w: Math.round(p.width), h: Math.round(p.height) });
  })()`));
  // OV.top=8, OV.rowH=14，chr19 在 hg38 列表里的下标
  const idx = await ev(`window.__igv.S.asm.chroms ? (() => {
    const list = Object.keys(window.__igv.S.asm.chroms);
    return list.indexOf('chr19');
  })() : -1`);
  const cy = geo.top + 8 + idx * 14 + 7;
  const cx = geo.left + Math.round(geo.w * 0.35);
  await mouse('mousePressed', cx, cy);
  await mouse('mouseReleased', cx, cy);
  await sleep(1600);
  const after = JSON.parse(await state());
  console.log('点击后:', JSON.stringify(after.panels));
  checks.clickOnlyAffectsThatPane = /^chr19:/.test(after.panels[1])
    && /^chr7:/.test(after.panels[0]) && /^chr19:/.test(after.panels[2]);

  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(SHOT, Buffer.from(s.result.data, 'base64'));

  console.log('\nCHECKS:', JSON.stringify(checks));
  const ok = Object.values(checks).every(Boolean);
  console.log('RESULT:', ok ? 'PASS' : 'FAIL');
  await cdp.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
