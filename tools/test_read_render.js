'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

// 直接提取应用中的真实实现，不复制布局或绘图算法。
const app = fs.readFileSync(path.join(__dirname, '../src/web/app.js'), 'utf8');
const start = app.indexOf('  function cigarSegments(');
const end = app.indexOf('  function formatVal(', start);
assert(start >= 0 && end > start, '应能定位应用内 reads 绘图实现');
const rects = [];
const points = [];
const labels = [];
const sub = { textContent: '' };
const canvas = {};
const ctx = {
  fillStyle: '',
  save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
  closePath() {}, fill() {}, fillText(text) { labels.push(text); },
  fillRect(x, y, w, h) { rects.push({ x, y, w, h, color: this.fillStyle }); },
  moveTo(x, y) { points.push({ x, y }); },
  lineTo(x, y) { points.push({ x, y }); },
};
const element = { dataset: { align: 'bam' }, querySelector: () => sub };
let height = 0;
let origin = 0;
let scale = 1;
let strandColor = false;
let experimentType = 'auto';
let visibilityWindowKb = 0;
let alignDisplay;
const state = { act: 0, panels: [{ alignData: {}, view: { start: 0, end: 1000 } }], bw: { list: [{ id: 'bam' }] }, dpr: 1 };
const helperStart = app.indexOf('  function alignmentVisibility(');
const helperEnd = app.indexOf('\n  }', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, '应能定位真实窗口门槛 helper');
const sandbox = vm.createContext({
  S: state,
  C: { read: '#aaa', text: '#111', muted: '#777' },
  ALIGN_ROW_H: 13,
  window: { innerHeight: 900 },
  document: { querySelector: () => element },
  CSS: { escape: value => value },
  paneCanvas: () => canvas,
  alignActive: () => true,
  fitCanvas: (_, h) => { height = h; return { ctx, w: 1000, h }; },
  px: bp => (bp - origin) * scale,
  bwCfg: () => ({ strandColor, experimentType, visibilityWindowKb, alignDisplay }),
  T: text => text || '',
  eventPane: e => ({ idx: e.pane ?? 0 }),
  scheduleRender: () => {},
  packCalls: 0,
});
vm.runInContext(app.slice(helperStart, helperEnd + 4) + '\n' + app.slice(start, end) + `
  const originalPackReads = packReads;
  packReads = (reads, mode) => { packCalls++; return originalPackReads(reads, mode); };
  this.api = { cigarSegments, packReads, drawAlignTracks, scrollAlignmentTrack };
`, sandbox);
const { api } = sandbox;
const plain = value => JSON.parse(JSON.stringify(value));
function read(p, e, c = `${e - p}M`, f = 0) { return { p, e, c, f }; }
function draw(data) {
  state.panels[0].alignData.bam = data;
  rects.length = 0;
  points.length = 0;
  labels.length = 0;
  api.drawAlignTracks();
}
function withinCanvas() {
  for (const r of rects) {
    assert(r.h > 0, '绘制高度应为正');
    assert(r.y >= 0 && r.y + r.h <= height + 1e-8, '所有 read 方块/缺口应在画布内');
  }
  for (const p of points) assert(p.y >= 0 && p.y <= height + 1e-8, '箭头应在画布内');
}

const cigar = '4S10M2I5=3D7X11N6M2H';
assert.deepEqual(plain(api.cigarSegments(cigar, 100)), {
  blocks: [[100, 115], [118, 125], [136, 142]],
  gaps: [{ start: 115, end: 118, op: 'D' }, { start: 125, end: 136, op: 'N' }],
});
assert.deepEqual(plain(api.cigarSegments('5S2H', 50)), { blocks: [], gaps: [] });
assert.deepEqual(plain(api.cigarSegments('3M2P4M', 50)), { blocks: [[50, 57]], gaps: [] });

const packedReads = [read(0, 5), read(0, 10), read(5, 7), read(7, 10), read(10, 12)];
const stable = api.packReads(packedReads);
assert.equal(stable.rows, 2);
assert.deepEqual(plain(stable.items.map(item => item.lane)), [0, 1, 0, 0, 0]);
assert.deepEqual(plain(api.packReads(packedReads)), plain(stable), '重复布局应稳定');
const unsorted = [read(10, 20), read(0, 8), read(5, 11)];
const originalOrder = unsorted.slice();
assert.equal(api.packReads(unsorted).rows, 2);
assert.deepEqual(unsorted, originalOrder, '不改变输入数组顺序');
assert.equal(api.packReads([]).rows, 0);

let seed = 17;
const randomReads = [];
for (let i = 0; i < 3000; i++) {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  const p = seed % 10000;
  randomReads.push(read(p, p + 1 + ((seed >>> 12) % 300)));
}
const randomPacked = api.packReads(randomReads);
const lanes = new Map();
for (const item of randomPacked.items) {
  assert((lanes.get(item.lane) ?? -Infinity) <= item.r.p, '同 lane 的 reads 不应重叠');
  lanes.set(item.lane, item.r.e);
}
const events = randomReads.flatMap(r => [[r.p, 1], [r.e, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
let depth = 0;
let maxDepth = 0;
for (const [, delta] of events) { depth += delta; maxDepth = Math.max(maxDepth, depth); }
assert.equal(randomPacked.rows, maxDepth, 'lane 数应等于最大重叠深度');

// Virtual viewport retains all 1500 lanes while drawing readable visible rows.
const wheel = (deltaY, deltaMode = 0, pane = 0) => {
  const event = { deltaY, deltaMode, pane, target: { closest: () => element },
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  assert.equal(api.scrollAlignmentTrack(event), true);
  assert.ok(event.prevented && event.stopped);
};
for (const dpr of [1, 1.25, 1.5, 2]) {
  state.dpr = dpr;
  const data = { reads: Array.from({ length: 1500 }, () => read(100, 101)), total: 1500 };
  draw(data);
  assert.equal(data.readLayout.packed.rows, 1500);
  assert.equal(data.readLayout.packed.items.length, 1500);
  assert(rects.length < 300, '仅绘制可见行和滚动位置条');
  assert.equal(rects[0].h, 3, '默认 Squished 使用紧凑行高');
  assert(sub.textContent.includes('滚轮上下浏览'));
  const layout = data.readLayout;
  const count = sandbox.packCalls;
  wheel(130);
  draw(data);
  assert.equal(data.alignScroll.offset, 130);
  assert(sub.textContent.includes('行 27'));
  assert.equal(data.readLayout, layout);
  assert.equal(sandbox.packCalls, count, '滚动不得重新 packing 或取数');
  wheel(1e9);
  draw(data);
  assert.equal(data.alignScroll.offset, data.alignScroll.max);
  assert(sub.textContent.includes('/ 1500'));
  assert(rects.some(r => Math.abs(r.y + r.h - (height - 6)) < 1e-8), '最后一行可滚动至画布底部');
  wheel(-1e9);
  draw(data);
  assert.equal(data.alignScroll.offset, 0);
  wheel(2, 1); draw(data);
  assert.equal(data.alignScroll.offset, 10, '行单位wheel应换算CSS像素');
  data.reads = data.reads.slice(); draw(data);
  assert.notEqual(data.readLayout, layout);
  assert.equal(data.alignScroll.offset, 0, '新数据重置滚动位置');
  const replacement = data.readLayout;
  data.reads.push(read(100, 101)); data.total++; draw(data);
  assert.notEqual(data.readLayout, replacement);
  assert.equal(data.readLayout.packed.items.length, 1501);
}


state.dpr = 1;
origin = 100;
scale = 2;
draw({ reads: [read(100, 142, cigar)], total: 1 });
const deletion = rects.find(r => r.x === 30 && r.w === 6 && r.color === '#111');
const skip = rects.find(r => r.x === 50 && r.w === 22 && r.h === 0.75);
assert(deletion && deletion.h === 1.5, 'D 应位于完整 CIGAR 参考游标，并使用较粗线');
assert(skip && skip.color === '#96b8c8', 'N 应绘制独立浅蓝色的参考跳跃细线');
assert(rects.some(r => r.x === 0), '0-based 起始坐标应映射到画布原点');
withinCanvas();
strandColor = true;
draw({ reads: [read(100, 142, cigar, 16)], total: 1 });
assert(rects.some(r => r.color === '#5b7fd4'), '负链颜色仍应正确');
withinCanvas();

origin = 0;
scale = 1;
strandColor = false;
const deepCigarReads = Array.from({ length: 1500 }, (_, i) => {
  const r = read(100, 142, cigar, i % 2 ? 16 : 0);
  r.mm = [[0, 'A']];
  return r;
});
draw({ reads: deepCigarReads, total: 1500 });
assert(rects.filter(r => r.x === 115 && r.w === 3).length > 0, '可见行绘制正确的D');
assert(rects.filter(r => r.x === 125 && r.w === 11).length > 0, '可见行绘制正确的N');
assert(rects.some(r => r.color === '#3a9e5f'), '可见行保留错配');
assert.equal(state.panels[0].alignData.bam.readLayout.packed.items.length, 1500);
assert(rects.length < 900, '复杂CIGAR也仅绘制可见行');

// 即使旧缓存仍有 reads，绘图也须先按当前实验门槛隐藏；缩回门槛内才能复用。
for (const [type, limit] of [['other', 30000], ['rna', 300000], ['third_gen', 1000000]]) {
  state.bw.list[0].experimentType = type;
  const data = { reads: [read(100, 101)], total: 1 };
  state.panels[0].view.end = limit;
  draw(data);
  assert.equal(rects.length, 1, '等于门槛时允许绘制');
  const calls = sandbox.packCalls;
  state.panels[0].view.end = limit + 1;
  draw(data);
  assert.equal(rects.length, 0, '超过门槛不应绘制旧 reads 缓存');
  assert(labels.some(text => text.includes('Zoom in')), '超过门槛应提示放大');
  assert.equal(sandbox.packCalls, calls, '门槛外不应重做布局');
  state.panels[0].view.end = limit;
  draw(data);
  assert.equal(rects.length, 1, '缩回门槛内应恢复绘制');
  assert.equal(sandbox.packCalls, calls, '回到窗口内可复用已有布局');
}
visibilityWindowKb = 5;
state.panels[0].view.end = 5001;
draw({ reads: [read(100, 101)], total: 1 });
assert.equal(rects.length, 0, '自定义窗口门槛应覆盖实验类型');
assert(labels.some(text => text.includes('Zoom in')));
visibilityWindowKb = 0;
state.panels[0].view.end = 1000;
draw({ reads: null, reason: '读取失败：测试异常' });
assert.deepEqual(labels, ['读取失败：测试异常'], '错误 reason 应显示而不是读取中');
delete state.bw.list[0].experimentType;

// Four display modes change layout only, never drop records.
const modesData = { reads: [read(0, 1), read(10, 11), read(20, 21)], total: 3 };
draw(modesData);
assert.equal(modesData.readLayout.mode, 'squished', '默认 Squished');
assert.equal(modesData.readLayout.packed.rows, 1);
alignDisplay = 'expanded'; draw(modesData);
assert.equal(modesData.readLayout.packed.rows, 1);
alignDisplay = 'squished'; draw(modesData);
assert.equal(modesData.alignScroll.rowH, 5);
alignDisplay = 'collapsed'; draw(modesData);
assert.equal(modesData.readLayout.packed.rows, 1);
assert.equal(modesData.readLayout.packed.items.length, 3);
alignDisplay = undefined;

// Wheel applies to the hovered split pane and cannot leak to other panels.
const firstOffset = modesData.alignScroll.offset;
state.panels.push({ alignData: { bam: { reads: [read(0, 1)], alignScroll: { offset: 0, max: 500, rowH: 13, height: 100 } } } });
wheel(100, 0, 1);
assert.equal(state.panels[1].alignData.bam.alignScroll.offset, 100);
assert.equal(modesData.alignScroll.offset, firstOffset);
state.panels.pop();
assert.equal(api.scrollAlignmentTrack({ ctrlKey: true, target: { closest: () => element } }), false);
assert.equal(api.scrollAlignmentTrack({ target: { closest: () => null } }), false);

// Exercise the actual context menu callbacks with a small isolated DOM.
const menuStart = app.indexOf('  function renderPopAlign(');
const menuEnd = app.indexOf('\n  }', menuStart);
const menuState = { panels: [{ alignData: { bam: { readLayout: {}, alignScroll: {} } } }] };
let menuMode = 'squished';
let closed = false;
const menuSandbox = vm.createContext({
  S: menuState,
  document: { createElement: tag => ({ tag, children: [], append(...items) { this.children.push(...items); } }) },
  bwCfg: () => ({ alignDisplay: menuMode }),
  setBwCfg: (id, patch) => { assert.equal(id, 'bam'); menuMode = patch.alignDisplay; },
  popHead: () => {}, closeTrackPop: () => { closed = true; },
  T: text => text,
});
vm.runInContext(app.slice(menuStart, menuEnd + 4), menuSandbox);
const pop = { rows: [], appendChild(row) { this.rows.push(row); } };
menuSandbox.renderPopAlign(pop, 'bam');
const modeRows = pop.rows.filter(row => row.children.length === 2);
assert.deepEqual(modeRows.map(row => row.children[1].textContent), ['Collapsed', 'Expanded', 'Squished', 'Full']);
assert.deepEqual(modeRows.map(row => row.children[0].checked), [false, false, true, false]);
modeRows[2].children[0].onchange();
assert.equal(menuMode, 'squished');
assert.ok(closed);
assert.equal(menuState.panels[0].alignData.bam.readLayout, undefined);
assert.equal(menuState.panels[0].alignData.bam.alignScroll, undefined);
assert(app.includes("openTrackPop(trk.querySelector('.track-label'), 'align', trk.dataset.align)"));
for (const label of ['Coverage', 'Junctions', 'Alignments']) assert(app.includes(label));

const benchmark = Array.from({ length: 20000 }, () => read(100, 101));
const t0 = performance.now();
const deep = api.packReads(benchmark);
const elapsed = performance.now() - t0;
assert.equal(deep.rows, 20000);
assert.equal(deep.items.length, 20000);
console.log(`通过：CIGAR/D/N、布局缓存、1500+行虚拟滚动/底部可达（4 DPR）、像素/行单位滚轮、分屏隔离、默认Squished及四模式无丢记录、窗口门槛与错误提示。20000 lane 布局 ${elapsed.toFixed(1)}ms。`);
