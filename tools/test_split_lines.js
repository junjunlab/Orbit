// CDP test: 分屏竖线必须是「一整条」，不能在行间 / 不分屏的行 / 标签列变宽后断开。
// 前置：开发服务器 8799（在 igv_0.2 下起）；cdp.js 会自己拉起无头 Chrome。
const fs = require('fs');
const path = require('path');
const { connect } = require('./cdp');

const PORT = process.env.IGV_TEST_PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/?db=hg38&locus=chr17:7500000-7760000`;
const SHOT = path.join(__dirname, '_split_lines_test.png');
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
  const geo = () => ev(`(() => {
    const view = document.querySelector('#view');
    const ov = view.querySelector(':scope > .split-lines');
    const vb = view.getBoundingClientRect();
    const ruler = [...view.querySelectorAll('.track[data-track="ruler"] .pane')];
    const rows = [...view.querySelectorAll('.track')].filter((r) => !r.hidden);
    return JSON.stringify({
      panels: window.__igv.S.panels.length,
      hasOv: !!ov,
      ovH: ov ? parseFloat(ov.style.height) || 0 : 0,
      ovTop: ov ? ov.getBoundingClientRect().top : null,
      ovBottom: ov ? ov.getBoundingClientRect().bottom : null,
      lines: ov ? [...ov.children].map((c) => Math.round(parseFloat(c.style.left) * 10) / 10) : [],
      paneX: ruler.map((p) => Math.round((p.getBoundingClientRect().left - vb.left) * 10) / 10),
      viewH: view.clientHeight,
      scrollH: view.scrollHeight,
      // 每行 body 的上下边界，用来确认线没有在行内断掉
      rows: rows.map((r) => {
        const b = r.querySelector('.track-body').getBoundingClientRect();
        return [Math.round(b.top), Math.round(b.bottom)];
      }),
      paneBorderW: (() => {
        const p = view.querySelector('.pane[data-p="1"]');
        return p ? getComputedStyle(p).borderLeftWidth : null;
      })(),
      // 行的 border-bottom 也不再挡线（overlay 盖在上面）
      ovZ: ov ? getComputedStyle(ov).zIndex : null,
      ovPE: ov ? getComputedStyle(ov).pointerEvents : null,
    });
  })()`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(600);
  await ev('localStorage.clear(); sessionStorage.clear();');
  await send('Page.navigate', { url: URL });
  if (!await waitBoot()) { console.error('boot timeout'); await cdp.close(); process.exit(1); }
  await sleep(1800);

  const checks = {};
  const g0 = JSON.parse(await geo());
  checks.singlePaneNoOverlay = g0.panels === 1 && g0.hasOv === false;

  // 1) 切 4 屏
  await ev('window.__igv.setPanelCount(4)');
  await sleep(2200);
  const g4 = JSON.parse(await geo());
  checks.overlayAppears = g4.panels === 4 && g4.hasOv === true && g4.lines.length === 3;
  // 2) 每条线与 pane 边界对齐（差 < 1px）
  const paneXs = g4.paneX.slice(1);
  checks.alignedToPanes = paneXs.length === 3
    && paneXs.every((x, i) => Math.abs(x - g4.lines[i]) <= 1);
  // 3) 高度铺满整个可滚动内容（>= scrollHeight，>= clientHeight）
  checks.fullHeight = g4.ovH >= Math.max(g4.scrollH, g4.viewH) - 1;
  // 4) 覆盖到最后一条轨道行的底部（不再有行内断口）
  const lastRowBottom = Math.max(...g4.rows.map((r) => r[1]));
  checks.coversLastRow = g4.ovBottom >= lastRowBottom - 1;
  checks.coversFirstRow = g4.ovTop <= Math.min(...g4.rows.map((r) => r[0])) + 1;
  // 5) pane 自己不再画 border-left（否则会变成双线）
  checks.noPaneBorder = g4.paneBorderW === '0px';
  checks.nonInteractive = g4.ovPE === 'none';

  // 6) 标签列变宽 → 竖线跟着走
  await ev('window.__igv.applyLabelW(240)');
  await sleep(900);
  const gW = JSON.parse(await geo());
  // 标签列 96 → 240（+144），内容区变窄后每屏各少 36px，所以第一条线只右移 108
  const shift = gW.lines[0] - g4.lines[0];
  checks.followsLabelWidth = shift > 100
    && Math.abs((gW.paneX[1] - gW.lines[0])) <= 1;
  await ev('window.__igv.applyLabelW(96)');
  await sleep(900);

  // 7) 回到单屏 → overlay 移除
  await ev('window.__igv.setPanelCount(1)');
  await sleep(1600);
  const g1 = JSON.parse(await geo());
  checks.removedOnCollapse = g1.panels === 1 && g1.hasOv === false;

  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(SHOT, Buffer.from(s.result.data, 'base64'));

  console.log('单屏   :', JSON.stringify(g0));
  console.log('四屏   :', JSON.stringify({ lines: g4.lines, paneX: g4.paneX, ovH: g4.ovH, scrollH: g4.scrollH }));
  console.log('标签宽 :', JSON.stringify({ lines: gW.lines, paneX: gW.paneX, shift }));
  console.log('\nCHECKS:', JSON.stringify(checks));
  const ok = Object.values(checks).every(Boolean);
  console.log('RESULT:', ok ? 'PASS' : 'FAIL');
  await cdp.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
