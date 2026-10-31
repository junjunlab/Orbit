// CDP test: 在第二列（轨道标签列）上直接按住上下拖动，可以把整行换到别的行位置，
// 顺序存进 localStorage，刷新后还在。
// 前置：开发服务器 8799、无头 Chrome 9222（cdp.js 会自动拉起）。
const fs = require('fs');
const path = require('path');
const { connect } = require('./cdp');

const PORT = process.env.IGV_TEST_PORT || '8799';
const URL = `http://127.0.0.1:${PORT}/?db=hg38&locus=chr8:127735000-127743000`;
const OUT = path.join(__dirname, '_track_reorder.png');
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
  const order = () => ev(`JSON.stringify({
    dom: [...document.querySelectorAll('#view .track')].map((e) => e.dataset.tkey || null).filter(Boolean),
    saved: window.__igv.S.trackOrder,
    ls: (JSON.parse(localStorage.getItem('igvlocal.prefs.v1') || '{}').trackOrder) || null
  })`);
  const rectOf = (key) => ev(`(() => {
    const el = document.querySelector('#view .track[data-tkey="' + ${JSON.stringify(key)} + '"]');
    if (!el) return null;
    const l = el.querySelector('.track-label').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: Math.round(l.left + l.width / 2), y: Math.round(l.top + l.height / 2),
             top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
  })()`);

  const mouse = (type, x, y, extra) => send('Input.dispatchMouseEvent', Object.assign(
    { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }, extra || {}));

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(800);
  await ev('localStorage.clear()');   // 每次都从默认顺序开始，避免上一次的残留
  await send('Page.navigate', { url: URL });
  if (!await waitBoot()) { console.error('boot timeout'); await cdp.close(); process.exit(1); }
  await sleep(1500);

  const before = JSON.parse(await order());
  console.log('BEFORE dom   :', before.dom.join(' | '));
  console.log('BEFORE saved :', (before.saved || []).join(' | '));

  const gc = await rectOf('s:gc');
  const genes = await rectOf('s:genes');
  if (!gc || !genes) { console.error('找不到 gc / genes 行', gc, genes); await cdp.close(); process.exit(1); }
  console.log('gc label @', gc.x, gc.y, ' genes row top', genes.top);

  // 1) 普通点击（不移动）不应该改变顺序
  await mouse('mousePressed', gc.x, gc.y);
  await mouse('mouseReleased', gc.x, gc.y);
  await sleep(250);
  const afterClick = JSON.parse(await order());
  const clickKeptOrder = afterClick.dom.join() === before.dom.join();

  // 2) 从 gc 的标签列按住往上拖到 genes 上方
  await mouse('mousePressed', gc.x, gc.y);
  const targetY = genes.top + 3;
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', gc.x, Math.round(gc.y + (targetY - gc.y) * (i / steps)));
    await sleep(40);
  }
  await mouse('mouseReleased', gc.x, targetY);
  await sleep(400);

  const after = JSON.parse(await order());
  console.log('AFTER  dom   :', after.dom.join(' | '));
  console.log('AFTER  saved :', (after.saved || []).join(' | '));
  console.log('AFTER  ls    :', (after.ls || []).join(' | '));

  const gi = after.dom.indexOf('s:gc');
  const si = after.dom.indexOf('s:genes');
  const movedUp = gi >= 0 && si >= 0 && gi < si;
  const savedOk = JSON.stringify(after.ls) === JSON.stringify(after.dom);
  const dragging = await ev(`document.querySelectorAll('.track.trk-dragging').length`);
  const bodyCls = await ev(`document.body.classList.contains('trk-reordering')`);

  // 3) 刷新后顺序是否还在
  await send('Page.navigate', { url: URL });
  await waitBoot();
  await sleep(1500);
  const afterReload = JSON.parse(await order());
  console.log('RELOAD dom   :', afterReload.dom.join(' | '));
  // igv_0.2 起「每次启动/刷新都从零开始」，所以刷新后应回到默认顺序（见 test_fresh_start.js）
  const resetOnReload = afterReload.dom.join() === before.dom.join();

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));

  const checks = {
    clickKeptOrder, movedUp, savedOk,
    cleanAfterDrag: dragging === 0 && bodyCls === false,
    resetOnReload,
  };
  console.log('\nCHECKS:', JSON.stringify(checks, null, 0));
  const ok = Object.values(checks).every(Boolean);
  console.log('RESULT:', ok ? 'PASS' : 'FAIL');
  await cdp.close();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => { console.error('FATAL', e); process.exit(1); });
