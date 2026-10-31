'use strict';

// 直接提取 app.js 的实际函数；DOM、画布和网络仅使用隔离 mock，不连接服务或用户数据。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../src/web/app.js'), 'utf8');
const names = [
  'bwDelete', 'ensureBwTrackEls', 'clearJunctionTrack', 'junctionRequestCurrent',
  'drawJunctionTracks', 'trackKey', 'trackRows', 'readTrackOrderFromDom',
  'syncTrackOrder', 'applyTrackOrder', 'bwCfg', 'alignmentVisibility', 'renderPopJunc', 'renderPopAlign',
];
const code = names.map((name) => {
  const start = source.search(new RegExp('^  (?:async )?function ' + name + '\\(', 'm'));
  assert.notEqual(start, -1, `未找到实际函数 ${name}`);
  const end = source.indexOf('\n  }', start);
  assert.notEqual(end, -1, `未找到函数结束 ${name}`);
  return source.slice(start, end + 4);
}).join('\n');
const rows = [];
const calls = [];
class Element {
  constructor() { this.dataset = {}; this.hidden = false; this.sub = {}; this.name = {}; this.children = []; }
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.children.push(item); }
  remove() { const i = rows.indexOf(this); if (i >= 0) rows.splice(i, 1); }
  after(el) { el.remove(); rows.splice(rows.indexOf(this) + 1, 0, el); }
  querySelector(selector) { return selector === '.sub' ? this.sub : selector === '.nm' ? this.name : null; }
}
function matches(el, selector) {
  const m = selector.match(/data-([a-z]+)(?:="([^"]*)")?/);
  return m ? m[2] === undefined ? m[1] in el.dataset : el.dataset[m[1]] === m[2] : true;
}
const view = {
  querySelector: (s) => rows.find((e) => matches(e, s)),
  querySelectorAll: (s) => rows.filter((e) => matches(e, s)),
  insertBefore(el, anchor) {
    el.remove();
    const i = rows.indexOf(anchor);
    rows.splice(i < 0 ? rows.length : i, 0, el);
  },
};
const track = { id: 'sample:a.bam', format: 'bam' };
const panel = { view: { chrom: 'chr1', start: 0, end: 100 }, bwData: {}, alignData: {} };
const S = {
  bw: { list: [track], on: { [track.id]: true }, hidden: new Set(), sel: new Set(),
    onSaved: {}, colors: {}, cfg: {}, data: {} },
  panels: [panel], act: 0, asm: { id: 'test' },
  trackOrder: ['al:' + track.id, 'bw:' + track.id], pending: 0, genomeView: false,
};
Object.defineProperty(S, 'view', { get: () => S.panels[S.act].view });
const ctx = {};
for (const name of ['save', 'restore', 'beginPath', 'rect', 'clip', 'moveTo',
  'bezierCurveTo', 'closePath', 'stroke', 'fill', 'lineTo', 'fillText']) {
  ctx[name] = (...args) => calls.push([name, ...args]);
}
const requests = [];
const noop = () => {};
const context = {
  S, CSS: { escape: (s) => s },
  document: { createElement: () => new Element(),
    querySelector: (s) => view.querySelector(s), querySelectorAll: (s) => view.querySelectorAll(s) },
  $: (s) => s === '#view' ? view : s === '#bwSec' ? {} : null,
  $$: () => rows.slice(), T: (s) => s,
  isBam: (t) => t.format === 'bam', alignId: (t) => t.id + '::align',
  bwActive: (t) => !!S.bw.on[t.id],
  alignActive: (t) => !!S.bw.on[t.id] && S.bw.on[t.id + '::align'] !== false,
  confirm: () => true, closeBwCtx: noop, closeTrackPop: noop, setLoading: noop,
  savePrefs: noop, renderBwList: noop, scheduleRender: noop, toast: noop, popHead: noop,
  ALIGN_SUF: '::align',
  setBwCfg: (id, patch) => { S.bw.cfg[id] = { ...(S.bw.cfg[id] || {}), ...patch }; },
  paneCanvas: () => ({}), fitCanvas: () => ({ ctx, w: 100, h: 64 }),
  C: { muted: '#999' }, BW_PALETTE: ['#999'], AbortController,
  api: (url, args, options) => new Promise((resolve, reject) => {
    requests.push({ url, args, options, resolve, reject });
  }),
};
vm.createContext(context);
vm.runInContext(code, context);
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const junctionRow = () => rows.find((e) => e.dataset.junc === track.id);
const rowTypes = () => rows.map((e) => Object.keys(e.dataset).find((key) => key !== 'tkey'));

async function main() {
  const orphan = new Element(); orphan.dataset.junc = 'gone'; rows.push(orphan);
  context.ensureBwTrackEls();
  const duplicate = new Element(); duplicate.dataset.junc = track.id; rows.push(duplicate);
  context.ensureBwTrackEls(); context.ensureBwTrackEls(); context.applyTrackOrder();
  assert.equal(rows.filter((e) => 'junc' in e.dataset).length, 1);
  assert.deepEqual(rowTypes(), ['bw', 'junc', 'align']);
  assert.equal(context.bwCfg(track.id).alignDisplay, 'squished');
  assert.equal(rows.find(e => e.dataset.bw === track.id).name.textContent, track.id + ' · Coverage');
  const second = { id: 'second', name: 'sample-two.bam', format: 'bam' };
  S.bw.list.push(second); S.bw.on[second.id] = true;
  context.ensureBwTrackEls();
  assert.equal(rows.find(e => e.dataset.align === second.id).name.textContent, 'sample-two.bam · Alignments');
  const menu = new Element(); context.renderPopJunc(menu, track.id);
  menu.children.find(e => e.textContent === '移除当前轨道').onclick();
  assert.equal(junctionRow().hidden, true);
  assert.equal(rows.find(e => e.dataset.junc === second.id).hidden, false, '移除一个样本不影响另一个');
  assert.equal(S.bw.on[track.id], true, '不删除BAM');
  S.bw.cfg[track.id].junctionVisible = true;
  const alignMenu = new Element(); context.renderPopAlign(alignMenu, track.id);
  alignMenu.children.find(e => e.textContent === '移除当前轨道').onclick();
  assert.equal(rows.find(e => e.dataset.align === track.id).hidden, true);
  assert.equal(junctionRow().hidden, false, 'Alignments移除独立于Junctions');
  S.bw.on[track.id + '::align'] = true;
  S.bw.list = [track]; delete S.bw.on[second.id];
  for (const row of rows.slice()) if ([row.dataset.bw, row.dataset.align, row.dataset.junc].includes(second.id)) row.remove();
  context.ensureBwTrackEls();

  context.drawJunctionTracks();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].args.min, 1);
  context.drawJunctionTracks();
  assert.equal(requests.length, 1, '同一窗口在途请求不可重复创建');
  panel.view = { chrom: 'chr1', start: 100, end: 200 };
  context.drawJunctionTracks();
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(requests.length, 2);
  requests[0].resolve({ junctions: [{ n: 9 }] }); await tick();
  assert.equal(S.bw.juncData.size, 0);

  S.bw.on[track.id] = false; context.drawJunctionTracks();
  assert.equal(junctionRow().hidden, true);
  assert.equal(requests[1].options.signal.aborted, true);
  S.bw.on[track.id] = true; context.drawJunctionTracks();
  assert.equal(junctionRow().hidden, false);
  S.bw.on[track.id + '::align'] = false; context.drawJunctionTracks();
  assert.equal(junctionRow().hidden, false, '关闭Alignments不影响Junctions');
  S.bw.on[track.id + '::align'] = true;
  S.genomeView = true; context.drawJunctionTracks(); assert.equal(junctionRow().hidden, true);
  S.genomeView = false; context.drawJunctionTracks();
  S.bw.juncOn = false; context.drawJunctionTracks(); assert.equal(junctionRow().hidden, true);
  S.bw.juncOn = true; context.drawJunctionTracks();

  S.bw.juncData.set('old', { id: track.id, junctions: [] });
  await context.bwDelete([track.id]);
  assert.equal(rows.length, 0);
  assert.equal(S.bw.juncPending.size, 0);
  assert.equal(S.bw.juncData.size, 0);
  assert.ok(requests.every((r) => r.options.signal.aborted));
  // 重新加入同 id 后，旧请求即使忽略 abort 仍不可复活缓存。
  S.bw.list = [track]; S.bw.on[track.id] = true; context.ensureBwTrackEls();
  for (const request of requests) request.resolve({ junctions: [{ n: 99 }] });
  await tick(); assert.equal(S.bw.juncData.size, 0);

  for (let i = 0; i < 70; i++) {
    panel.view = { chrom: 'chr1', start: i * 100, end: i * 100 + 100 };
    context.drawJunctionTracks(); requests.at(-1).resolve({ junctions: [] }); await tick();
  }
  assert.equal(S.bw.juncData.size, 64);
  assert.equal(S.bw.juncPending.size, 0);

  panel.view = { chrom: 'chr1', start: 0, end: 100 };
  const key = JSON.stringify([S.asm.id, 0, track.id, 'chr1', 0, 100]);
  S.bw.juncData.set(key, { id: track.id, junctions: [
    { d: 10, a: 90, n: 60, strand: '+' }, { d: 10, a: 90, n: 60, strand: '-' },
  ] });
  calls.length = 0; context.drawJunctionTracks();
  assert.equal(rows.filter((e) => e.dataset.junc === track.id).length, 1);
  const curves = calls.filter((a) => a[0] === 'bezierCurveTo');
  assert.equal(curves.length, 4);
  for (const operation of ['fill', 'closePath']) {
    assert.equal(calls.filter((a) => a[0] === operation).length, 2);
  }
  assert.equal(calls.filter((a) => a[0] === 'clip').length, 3);
  assert.deepEqual(curves[0], ['bezierCurveTo', 8, -8, 92, -8, 90, 31]);
  assert.deepEqual(curves[1], ['bezierCurveTo', 92, 18, 8, 18, 10, 31]);
  assert.deepEqual(curves[2], ['bezierCurveTo', 8, 72, 92, 72, 90, 33]);
  assert.deepEqual(curves[3], ['bezierCurveTo', 92, 46, 8, 46, 10, 33]);
  assert.deepEqual(calls.find((a) => a[0] === 'lineTo'), ['lineTo', 100, 32]);
  S.bw.juncData.set(key, { id: track.id, junctions: [{ d: 10, a: 90, n: 600, strand: '+' }] });
  calls.length = 0; context.drawJunctionTracks();
  assert.deepEqual(calls.find((a) => a[0] === 'bezierCurveTo'), curves[0]);
  for (const [type, limit] of [['other', 30000], ['rna', 300000], ['third_gen', 1000000]]) {
    context.clearJunctionTrack(track.id);
    track.experimentType = type;
    panel.view = { chrom: 'chr1', start: 0, end: limit };
    let before = requests.length;
    context.drawJunctionTracks();
    assert.equal(requests.length, before + 1, `${type}边界应加载junction`);
    const currentRequest = requests.at(-1);
    panel.view.end++;
    context.drawJunctionTracks();
    assert.equal(currentRequest.options.signal.aborted, true, '越过visibility必须取消剪接请求');
    assert.equal(requests.length, before + 1, '宽窗口不可请求junction');
    currentRequest.resolve({ junctions: [{ n: 999 }] }); await tick();
    assert.equal(S.bw.juncData.size, 0, '宽窗口不接受迟到结果');
    panel.view.end = limit;
    context.drawJunctionTracks();
    requests.at(-1).resolve({ junctions: [] }); await tick();
    assert.equal(S.bw.juncData.size, 1, '缩窄后重取并正常缓存空数据');
    panel.view.end++;
    calls.length = 0;
    context.drawJunctionTracks();
    assert.ok(calls.some((a) => a[0] === 'fillText' && a[1].includes('放大查看剪接')),
      '门槛必须优先于缓存');
  }
  context.clearJunctionTrack(track.id);
  panel.view = { chrom: 'chr1', start: 0, end: 100 };
  context.drawJunctionTracks();
  requests.at(-1).reject(new Error('网络失败')); await tick();
  const failedRecord = [...S.bw.juncData.values()][0];
  assert.equal(failedRecord.error, true);
  assert.equal(failedRecord.junctions, undefined, '异常不可伪装成空junctions');
  calls.length = 0; context.drawJunctionTracks();
  assert.ok(calls.some((a) => a[0] === 'fillText' && a[1].includes('网络失败')));
  context.clearJunctionTrack(track.id);
  context.drawJunctionTracks();
  requests.at(-1).resolve({ junctions: [], reason: '缺少索引' }); await tick();
  assert.equal([...S.bw.juncData.values()][0].error, true);
  assert.equal([...S.bw.juncData.values()][0].reason, '缺少索引');
  console.log('通过：DOM 去重/孤立清理、排序、换窗取消、显隐重置、删除与迟到响应隔离、64项缓存、同轨道正负向三次填充弧、裁剪、min=1、深度60饱和、30/300/1000kb门槛、宽窄切换、异常与reason显示。');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
