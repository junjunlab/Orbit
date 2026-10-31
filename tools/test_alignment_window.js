'use strict';

// 提取实际前端函数；仅使用隔离网络/DOM mock，不连接服务或用户数据。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../src/web/app.js'), 'utf8');
const code = ['bwCfg', 'alignmentVisibility', 'dataRangeFor', 'ensureDataFor', 'drawBwTracks'].map((name) => {
  const start = source.search(new RegExp('^  (?:async )?function ' + name + '\\(', 'm'));
  assert.notEqual(start, -1, `未找到实际函数 ${name}`);
  const end = source.indexOf('\n  }', start);
  assert.notEqual(end, -1);
  return source.slice(start, end + 4);
}).join('\n');
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function fixture(width = 1000) {
  const track = { id: 'test.bam', format: 'bam' };
  const panel = { view: { chrom: 'chr1', start: 0, end: 10000 },
    data: { range: { start: 0, end: 0 }, loadedFor: null, seq: null, gc: null },
    bwData: {}, alignData: {} };
  const S = { asm: { id: 'test', chroms: { chr1: 10000000 }, hasSeq: false }, panels: [panel],
    tracks: { seq: false, gc: false }, pending: 0,
    bw: { cfg: {}, colors: {}, list: [track], on: {} } };
  const requests = [];
  const messages = [];
  const context = { S, BW_PALETTE: ['#999'], AbortController, performance,
    T: (s) => s, paneWidth: () => width, setLoading: () => {}, scheduleRender: () => {},
    $: () => ({}), toast: (s) => messages.push(s),
    isBam: (t) => t.format === 'bam' || t.format === 'sam',
    bwActive: (t) => S.bw.on[t.id] !== false,
    alignActive: (t) => (t.format === 'bam' || t.format === 'sam')
      && S.bw.on[t.id] !== false && S.bw.on[t.id + '::align'] !== false,
    api: (url, args, options) => new Promise((resolve, reject) => {
      requests.push({ url, args, options, resolve, reject });
    }) };
  vm.createContext(context); vm.runInContext(code, context);
  const run = (force = false) => context.ensureDataFor(panel, 0, force);
  const answer = (r) => {
    const common = { start: r.args.s, end: r.args.e };
    if (r.url === 'genes') return { ...common, genes: [], truncated: false, ms: 1 };
    if (r.url === 'bw') return { ...common, values: [], peak: 0 };
    if (r.url === 'loaded/bam') return { ...common, reads: [], total: 0, hasSeq: true };
    if (r.url === 'gc') return { gc: [0.5] };
    if (r.url === 'seq') return { ...common, seq: 'A'.repeat(r.args.e - r.args.s) };
    throw new Error(r.url);
  };
  const resolve = (list = requests) => { for (const r of list) r.resolve(answer(r)); };
  return { S, panel, track, context, requests, run, resolve, answer, messages };
}

async function main() {
  const h = fixture();
  const { track, S, context } = h;
  for (const [type, expected] of [['other', 30000], ['rna', 300000], ['third_gen', 1000000],
    ['RNA', 300000], ['THIRD_GEN', 1000000], ['unknown', 30000]]) {
    track.experimentType = type;
    assert.equal(context.alignmentVisibility(track), expected, `自动实验类型 ${type}`);
  }
  S.bw.cfg[track.id] = { experimentType: 'rna', visibilityWindowKb: null };
  track.experimentType = 'third_gen';
  assert.equal(context.alignmentVisibility(track), 300000, '手动类型优先于元信息');
  S.bw.cfg[track.id].visibilityWindowKb = 12.5;
  assert.equal(context.alignmentVisibility(track), 12500);
  for (const invalid of [0, -1, NaN, Infinity, '50']) {
    S.bw.cfg[track.id].visibilityWindowKb = invalid;
    assert.equal(context.alignmentVisibility(track), 300000, '仅正数窗口覆盖默认值');
  }
  assert.equal(context.bwCfg(track.id).experimentType, 'rna', '配置保留实验类型');

  for (const [type, limit] of [['other', 30000], ['rna', 300000], ['third_gen', 1000000]]) {
    for (const width of [100, 4000]) {
      const f = fixture(width);
      f.track.experimentType = type;
      f.panel.view.end = limit;
      const promise = f.run();
      assert.equal(f.requests.filter((r) => r.url === 'loaded/bam').length, 1, '边界可见且不依赖像素宽');
      for (const r of f.requests.filter((r) => r.url !== 'genes')) {
        assert.equal(r.args.s, 0); assert.equal(r.args.e, limit, 'BAM和覆盖度不加padding');
        assert.equal(Object.hasOwn(r.args, 'max'), false, '请求不可含截断max');
      }
      f.resolve(); await promise;
      f.panel.view.end = limit + 1;
      const before = f.requests.length;
      const wide = f.run();
      assert.equal(f.requests.slice(before).filter((r) => r.url !== 'genes').length, 0);
      assert.equal(f.panel.alignData[f.track.id].tooWide, true);
      assert.equal(f.panel.bwData[f.track.id].tooWide, true);
      f.resolve(); await wide;
      f.panel.view.end = limit;
      const retryAt = f.requests.length;
      const narrow = f.run();
      assert.equal(f.requests.slice(retryAt).filter((r) => r.url === 'loaded/bam').length, 1,
        '宽窗口占位不能阻止缩窄后重新请求');
      f.resolve(); await narrow;
    }
  }

  const cached = fixture();
  cached.panel.data = { range: { start: 0, end: 1000000 }, loadedFor: 'chr1', genes: [] };
  const load = cached.run();
  assert.equal(cached.requests.some((r) => r.url === 'genes'), false);
  assert.equal(cached.requests.some((r) => r.url === 'loaded/bam'), true, 'genes缓存不可全局跳过BAM');
  cached.resolve(); await load;
  const count = cached.requests.length;
  await cached.run();
  assert.equal(cached.requests.length, count, '成功的覆盖度和reads缓存可复用');
  cached.panel.alignData[cached.track.id] = { chrom: 'chr1', start: 0, end: 1000000,
    reads: [], error: true, loaded: true };
  const errorRetry = cached.run();
  assert.equal(cached.requests.length, count + 1, '错误占位不可充当成功缓存');
  cached.resolve(); await errorRetry;

  const unfinished = fixture();
  const first = unfinished.run();
  const old = unfinished.requests.slice();
  old.find((r) => r.url === 'genes').resolve(unfinished.answer(old[0]));
  await tick();
  const second = unfinished.run();
  assert.equal(old[0].options.signal.aborted, true);
  assert.equal(unfinished.requests.filter((r) => r.url === 'genes').length, 1);
  assert.equal(unfinished.requests.filter((r) => r.url === 'loaded/bam').length, 2,
    '取消在途请求后即使genes已缓存，也必须补取BAM');
  unfinished.resolve(); await Promise.all([first, second]);
  assert.equal(unfinished.S.pending, 0);

  for (const invalidate of ['delete', 'replace', 'inactive', 'assembly', 'view', 'abort']) {
    const f = fixture();
    f.S.asm.hasSeq = true; f.S.tracks = { seq: true, gc: true }; f.panel.view.end = 100;
    const promise = f.run();
    assert.equal(f.panel.data.loadedFor, null, 'genes完成前不标记range成功');
    if (invalidate === 'delete') f.S.bw.list = [];
    if (invalidate === 'replace') f.S.bw.list = [{ ...f.track }];
    if (invalidate === 'inactive') f.S.bw.on[f.track.id] = false;
    if (invalidate === 'assembly') f.S.asm = { ...f.S.asm };
    if (invalidate === 'view') f.panel.view.start++;
    if (invalidate === 'abort') f.panel._ac.abort();
    // mock故意忽略abort，模拟取消前已经返回或非合作网络层。
    f.resolve(); await promise; await tick();
    assert.equal(Object.hasOwn(f.panel.bwData, f.track.id), false, `${invalidate}后覆盖度不得写回`);
    assert.equal(Object.hasOwn(f.panel.alignData, f.track.id), false, `${invalidate}后reads不得写回`);
    if (['assembly', 'view', 'abort'].includes(invalidate)) {
      assert.equal(f.panel.data.loadedFor, null);
      assert.equal(f.panel.data.seq, null);
      assert.equal(f.panel.data.gc, null, 'GC/seq/genes迟到结果必须隔离');
    }
  }

  const lateError = fixture();
  const errorLoad = lateError.run();
  lateError.S.bw.list = [];
  for (const r of lateError.requests) {
    if (r.url === 'genes') r.resolve(lateError.answer(r));
    else r.reject(new Error('迟到失败'));
  }
  await errorLoad;
  assert.equal(Object.keys(lateError.panel.bwData).length, 0);
  assert.equal(Object.keys(lateError.panel.alignData).length, 0, '迟到catch也不能写回');

  const drawGate = fixture();
  drawGate.panel.view.end = 30001;
  drawGate.S.view = drawGate.panel.view;
  drawGate.S.bw.data = { [drawGate.track.id]: { values: [{ m: 100 }], start: 0, end: 1000000 } };
  const canvasCalls = [];
  const drawCtx = { fillText: (...args) => canvasCalls.push(args) };
  drawGate.context.document = { querySelector: () => ({ querySelector: () => ({}) }) };
  drawGate.context.CSS = { escape: (s) => s };
  drawGate.context.C = { muted: '#999' };
  drawGate.context.paneCanvas = () => ({});
  drawGate.context.fitCanvas = () => ({ ctx: drawCtx, w: 1000, h: 78 });
  drawGate.context.drawBwTracks();
  assert.ok(canvasCalls.some((a) => a[0].includes('放大查看覆盖度')), '绘制门槛先于旧coverage缓存');

  const failedGenes = fixture();
  const failed = failedGenes.run();
  failedGenes.requests.find((r) => r.url === 'genes').reject(new Error('网络失败'));
  failedGenes.resolve(); await failed;
  assert.equal(failedGenes.panel.data.loadedFor, null, 'genes失败不能标记成功range');
  const again = failedGenes.run();
  assert.equal(failedGenes.requests.filter((r) => r.url === 'genes').length, 2);
  failedGenes.resolve(); await again;
  console.log('通过：30/300/1000kb统一门槛、正数覆盖、像素宽无关、无max/padding、宽窄重取、genes独立缓存、未完成请求补取、成功缓存、错误重试、删除/替换/关闭/换装配/换窗口/取消的迟到响应隔离（含GC/seq/genes及catch）。');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
