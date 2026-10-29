// CDP test: BAM 的 coverage 行和「比对」行默认贴在一起，拖动时一起走；
// 同时抓一张拖动中的截图，确认被拖的行有高亮、其余行实时让位。
// 前置：开发服务器 8799、无头 Chrome 9222（cdp.js 会自动拉起）。
const fs = require('fs');
const path = require('path');
const { connect } = require('./cdp');

const PORT = process.env.IGV_TEST_PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/?db=hg38&locus=chr1:26100000-26120000`;
const BAM = path.join(__dirname, '..', 'data', 'samples', 'demo_align_bgzf.bam');
const NAME = 'demo_align_bgzf.bam';
const TID = 'demo_align_bgzf';
const OUT = path.join(__dirname, '_track_reorder_bam.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1) 先把样例 BAM 传到服务器（幂等：已存在就跳过）
  const listed = await (await fetch(`${BASE}/api/loaded`)).json();
  if (!(listed.tracks || []).some((t) => t.id === TID)) {
    const buf = fs.readFileSync(BAM);
    const r = await fetch(`${BASE}/api/load?name=${encodeURIComponent(NAME)}`, { method: 'POST', body: buf });
    const j = await r.json();
    console.log('upload ->', j.ok, j.track && j.track.id);
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
    saved: window.__igv.S.trackOrder
  })`);
  const rectOf = (sel) => ev(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    const l = el.querySelector('.track-label').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: Math.round(l.left + l.width / 2), y: Math.round(l.top + l.height / 2),
             top: Math.round(r.top), bottom: Math.round(r.bottom) };
  })()`);
  const shot = async (file) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  };
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(800);
  await ev('localStorage.clear()');   // 每次都从默认顺序开始
  await send('Page.navigate', { url: URL });
  if (!await waitBoot()) { console.error('boot timeout'); await cdp.close(); process.exit(1); }
  await sleep(2000);

  // 每次启动都会重置，自己导入过的轨道默认不挂出来 —— 测试里手动打开这两行
  await ev(`(() => {
    const ig = window.__igv;
    ig.S.bw.on['${TID}'] = true;
    ig.S.bw.on['${TID}::align'] = true;
    ig.loadBwTracks();
    return true;
  })()`);
  await sleep(1800);

  const before = JSON.parse(await order());
  console.log('BEFORE:', before.dom.join(' | '));

  const bw = await rectOf(`.track[data-bw="${TID}"]`);
  const al = await rectOf(`.track[data-align="${TID}"]`);
  const ideo = await rectOf('.track[data-track="ideogram"]');
  if (!bw || !al || !ideo) { console.error('缺轨道', { bw, al, ideo }); await cdp.close(); process.exit(1); }
  const adjacentBefore = before.dom.indexOf(`al:${TID}`) === before.dom.indexOf(`bw:${TID}`) + 1;
  console.log('bw label @', bw.x, bw.y, '| align @', al.x, al.y, '| ideogram top', ideo.top);

  // 2) 从 BAM coverage 的标签列往上拖到最顶部（染色体示意图之上）
  const targetY = ideo.top + 4;
  await mouse('mousePressed', bw.x, bw.y);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', bw.x, Math.round(bw.y + (targetY - bw.y) * (i / steps)));
    await sleep(50);
  }
  // 拖动中：截图 + 读高亮状态
  const midState = await ev(`JSON.stringify({
    dragging: [...document.querySelectorAll('.track.trk-dragging')].map((e) => e.dataset.tkey),
    bodyCls: document.body.classList.contains('trk-reordering'),
    cursor: getComputedStyle(document.querySelector('.track[data-bw="${TID}"] .track-label')).cursor
  })`);
  await shot(OUT);
  await mouse('mouseReleased', bw.x, targetY);
  await sleep(500);

  const after = JSON.parse(await order());
  console.log('AFTER :', after.dom.join(' | '));
  console.log('MID   :', midState);

  const mi = after.dom.indexOf(`bw:${TID}`);
  const ai = after.dom.indexOf(`al:${TID}`);
  const bi = before.dom.indexOf(`bw:${TID}`);
  const checks = {
    hadBamRows: before.dom.includes(`bw:${TID}`) && before.dom.includes(`al:${TID}`),
    adjacentBefore,
    movedToTop: mi === 0 && mi < bi,
    mateFollowed: ai === mi + 1,
    highlightDuringDrag: JSON.parse(midState || '{}').dragging.length === 2,
    savedOk: JSON.stringify(after.saved) === JSON.stringify(after.dom),
  };

  // 3) 刷新后还在
  await send('Page.navigate', { url: URL });
  await waitBoot();
  await sleep(2000);
  const reload = JSON.parse(await order());
  // 每次启动都重置（FRESH_EACH_LAUNCH），所以刷新后应回到默认顺序
  checks.resetsOnReload = reload.dom.join() === before.dom.join();
  console.log('RELOAD:', reload.dom.join(' | '));

  console.log('\nCHECKS:', JSON.stringify(checks));
  const ok = Object.values(checks).every(Boolean);
  console.log('RESULT:', ok ? 'PASS' : 'FAIL');
  await cdp.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
