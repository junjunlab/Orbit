// CDP test: 导入轨道（原来装在 #loadedTracks 里）现在是 #view 的直接子行，
// 可以拖到任意位置（含静态轨道之间）。
// 前置：开发服务器 8799、无头 Chrome 9222（cdp.js 会自动拉起）。
const fs = require('fs');
const path = require('path');
const { connect } = require('./cdp');

const PORT = process.env.IGV_TEST_PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/?db=hg38&locus=chr1:26100000-26120000`;
const SRC = path.join(__dirname, '..', 'data', 'samples', 'demo_genes.gtf');
const NAME = 'demo_genes.gtf';
const TID = 'demo_genes';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const listed = await (await fetch(`${BASE}/api/loaded`)).json();
  if (!(listed.tracks || []).some((t) => t.id === TID)) {
    const r = await fetch(`${BASE}/api/load?name=${encodeURIComponent(NAME)}`, { method: 'POST', body: fs.readFileSync(SRC) });
    console.log('upload ->', JSON.stringify(await r.json()).slice(0, 160));
  }

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
  const order = () => ev(`JSON.stringify({
    dom: [...document.querySelectorAll('#view .track')].map((e) => e.dataset.tkey).filter(Boolean),
    saved: window.__igv.S.trackOrder,
    parentIsView: [...document.querySelectorAll('.track[data-loaded]')].every((e) => e.parentElement.id === 'view'),
    visible: (() => { const e = document.querySelector('.track[data-loaded="${TID}"]'); return !!e && e.offsetHeight > 0; })(),
    canvasW: (() => { const c = document.querySelector('.track[data-loaded="${TID}"] canvas'); return c ? Math.round(c.getBoundingClientRect().width) : 0; })()
  })`);
  const rectOf = (sel) => ev(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    const l = el.querySelector('.track-label').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: Math.round(l.left + l.width / 2), y: Math.round(l.top + l.height / 2), top: Math.round(r.top) };
  })()`);
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(800);
  await ev('localStorage.clear()');
  await send('Page.navigate', { url: URL });
  if (!await waitBoot()) { console.error('boot timeout'); await cdp.close(); process.exit(1); }
  await sleep(2500);

  // 每次启动都会重置，导入的轨道默认不挂出来 —— 测试里手动打开
  await ev(`(() => {
    const ig = window.__igv;
    ig.S.loaded.on['${TID}'] = true;
    ig.loadLoadedTracks();
    return true;
  })()`);
  await sleep(1800);

  const before = JSON.parse(await order());
  console.log('BEFORE:', before.dom.join(' | '));
  console.log('loaded row parent=#view:', before.parentIsView, 'visible:', before.visible, 'canvasW:', before.canvasW);

  const ld = await rectOf(`.track[data-loaded="${TID}"]`);
  const ideo = await rectOf('.track[data-track="ideogram"]');
  if (!ld || !ideo) { console.error('缺轨道', { ld, ideo }); await cdp.close(); process.exit(1); }

  const targetY = ideo.top + 4;
  await mouse('mousePressed', ld.x, ld.y);
  for (let i = 1; i <= 10; i++) {
    await mouse('mouseMoved', ld.x, Math.round(ld.y + (targetY - ld.y) * (i / 10)));
    await sleep(50);
  }
  await mouse('mouseReleased', ld.x, targetY);
  await sleep(600);

  const after = JSON.parse(await order());
  console.log('AFTER :', after.dom.join(' | '));
  const li = after.dom.indexOf(`ld:${TID}`);
  const checks = {
    loadedInView: before.parentIsView,
    loadedVisible: before.visible && before.canvasW > 100,
    hadLoadedRow: before.dom.includes(`ld:${TID}`),
    movedToTop: li === 0 && li < before.dom.indexOf(`ld:${TID}`),
    savedOk: JSON.stringify(after.saved) === JSON.stringify(after.dom),
    stillVisible: after.visible && after.canvasW > 100,
  };

  await send('Page.navigate', { url: URL });
  await waitBoot();
  await sleep(2500);
  const reload = JSON.parse(await order());
  // 每次启动都重置（FRESH_EACH_LAUNCH）：刷新后顺序回默认，导入的轨道也不再挂出来
  const noLd = (arr) => arr.filter((k) => !k.startsWith('ld:')).join();
  checks.resetsOnReload = noLd(reload.dom) === noLd(before.dom)
    && !reload.dom.includes(`ld:${TID}`);
  console.log('RELOAD:', reload.dom.join(' | '));

  console.log('\nCHECKS:', JSON.stringify(checks));
  const ok = Object.values(checks).every(Boolean);
  console.log('RESULT:', ok ? 'PASS' : 'FAIL');
  await cdp.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
