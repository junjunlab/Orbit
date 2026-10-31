'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../src/web/app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '../src/web/i18n.js'), 'utf8');
function source(name) {
  const start = app.indexOf(`  function ${name}(`);
  const end = app.indexOf('\n  }', start);
  assert(start >= 0 && end > start, `应找到真实函数 ${name}`);
  return app.slice(start, end + 4);
}
function element(tag) {
  return {
    tag, children: [], style: {}, textContent: '',
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},          // details 的 toggle（展开后把清单滚进可视区）
    scrollIntoView() {},
    setAttribute() {},
    append(...children) { this.children.push(...children); },
    set innerHTML(_) { throw new Error('详情不得通过 innerHTML 插入内容'); },
  };
}
let lang = 'zh';
const dictionaries = {};
for (const language of ['zh', 'en']) {
  const window = {};
  vm.runInNewContext(i18n, { window, localStorage: { getItem: () => language }, document: { readyState: 'loading', addEventListener() {} } });
  dictionaries[language] = window.I18N;
}
const S = {
  act: 0,
  panels: [{ view: { chrom: 'chr1', start: 0, end: 1000 } }, { view: { chrom: 'chr2', start: 1000, end: 2000 } }],
  data: { genes: [] },
};
Object.defineProperty(S, 'view', { get() { return this.panels[this.act].view; } });
const sandbox = vm.createContext({
  S, ROW_H: 22, LROW: 20, GENE_FONT: '',
  requestAnimationFrame: (fn) => fn(), setTimeout: (fn) => fn(), clampTrackPop: () => {}, REPEAT_LABEL_BP_PER_PX: 40, REPEAT_MAX_ROWS: 12, LOADED_MAX_ROWS: 60,
  trackWidth: () => 1000, textWidth: text => text.length * 6,
  geneCollapsed: () => true, isExpanded: g => !!g.expanded, isLoadedExpanded: (_, g) => !!g.expanded,
  px: bp => bp - S.view.start, bpAt: x => x + S.view.start,
  T: text => dictionaries[lang].t(text), fmt: n => n.toLocaleString('en-US'),
  document: { createElement: element },
  popHead: (pop, text) => { const h = element('h5'); h.textContent = text; pop.appendChild(h); },
  popSep: pop => pop.appendChild(element('hr')),
});
const names = ['geneFeatureDetails', 'geneDetailsAt', 'geneDetailsForEvent', 'renderGeneDetails', 'geneFeatureHoverText',
  'geneLayout', 'loadedGeneLayout', 'placedForPane', 'txIndexAt', 'loadedTxAt', 'withPanel', 'eventPane'];
vm.runInContext(names.map(source).join('\n') + '\nthis.api = {' + names.join(',') + '};', sandbox);
const { api } = sandbox;
const plain = value => JSON.parse(JSON.stringify(value));
const tx = { name: 'tx1', start: 100, end: 600, cdsStart: 220, cdsEnd: 420, exons: [[100, 150], [200, 250], [300, 350], [400, 450], [500, 600]] };
const gene = { name: 'GENE', id: 'g1', chrom: 'chr1', start: 100, end: 600, strand: '+', tx: [tx] };
function features(bp, strand = '+', transcript = tx) {
  return plain(api.geneFeatureDetails({ ...gene, strand }, transcript, bp)?.features ?? null);
}
function checkFeature(bp, strand, kind, number, total, start, end) {
  assert.deepEqual(features(bp, strand).find(f => f.kind === kind), { kind, number, total, start, end });
}
checkFeature(110, '+', 'exon', 1, 5, 100, 150);
checkFeature(510, '-', 'exon', 1, 5, 500, 600);
checkFeature(150, '+', 'intron', 1, 4, 150, 200);
checkFeature(150, '-', 'intron', 4, 4, 150, 200);
checkFeature(450, '-', 'intron', 1, 4, 450, 500);
checkFeature(220, '+', 'CDS', 1, 3, 220, 250);
checkFeature(300, '+', 'CDS', 2, 3, 300, 350);
checkFeature(400, '-', 'CDS', 1, 3, 400, 420);
checkFeature(220, '-', 'CDS', 3, 3, 220, 250);
checkFeature(110, '+', '5UTR', 1, 2, 100, 150);
checkFeature(210, '+', '5UTR', 2, 2, 200, 220);
checkFeature(420, '+', '3UTR', 1, 2, 420, 450);
checkFeature(550, '+', '3UTR', 2, 2, 500, 600);
checkFeature(550, '-', '5UTR', 1, 2, 500, 600);
checkFeature(420, '-', '5UTR', 2, 2, 420, 450);
checkFeature(210, '-', '3UTR', 1, 2, 200, 220);
checkFeature(110, '-', '3UTR', 2, 2, 100, 150);
assert.equal(features(99), null);
assert.equal(features(600), null, '转录本右端点不命中');
assert.equal(features(149).some(f => f.kind === 'exon'), true);
assert.equal(features(150).some(f => f.kind === 'exon'), false);
assert.equal(features(199).some(f => f.kind === 'intron'), true);
assert.equal(features(200).some(f => f.kind === 'intron'), false);
assert.equal(features(219).some(f => f.kind === 'CDS'), false);
assert.equal(features(220).some(f => f.kind === '5UTR'), false);
assert.equal(features(419).some(f => f.kind === 'CDS'), true);
assert.equal(features(420).some(f => f.kind === 'CDS'), false);
const noncoding = { ...tx, cdsStart: 100, cdsEnd: 100 };
assert.deepEqual(features(110, '+', noncoding).map(f => f.kind), ['exon']);
assert.equal(api.geneFeatureDetails(gene, noncoding, 110).coding, false);
assert.deepEqual(features(110, '+', { ...tx, cdsStart: undefined, cdsEnd: undefined }).map(f => f.kind), ['exon']);
assert.deepEqual(tx.exons[0], [100, 150], '不修改源模型');
const unsorted = { ...tx, exons: [...tx.exons].reverse() };
assert.deepEqual(features(110, '+', unsorted), features(110));
assert.deepEqual(features(250).map(f => f.kind), ['intron'], 'CDS范围中的内含子不能算CDS');

const tx2 = { ...tx, name: 'tx2', start: 200, end: 450 };
const overlapping = { ...gene, name: 'OTHER', id: 'g2', tx: [{ ...tx, name: 'tx3' }] };
S.data.genes = [{ ...gene, tx: [tx, tx2] }, overlapping];
const track = { id: 'imported' };
function updatePlaced(pid = S.act) {
  track._placedByPane = track._placedByPane || {};
  track._placedByPane[pid] = api.loadedGeneLayout(track, { genes: S.data.genes }).placed;
}
function compare(x, refY = 17, loadedY = 16) {
  updatePlaced();
  const ref = plain(api.geneDetailsAt(x, refY));
  const imported = plain(api.geneDetailsAt(x, loadedY, track, S.act));
  assert.deepEqual(imported, ref, 'RefSeq与导入注释使用同一详情算法');
  return ref;
}
assert.equal(compare(225).entries.length, 3, '折叠模式枚举重叠基因和全部命中转录本');
assert.deepEqual(compare(225).entries.map(e => e.txId), ['tx1', 'tx2', 'tx3']);
assert.equal(compare(150).entries.length, 2, '不列出范围外的转录本');
assert.equal(compare(600).entries.length, 0, '基因右端点严格半开');
assert.equal(compare(225, 39, 36).entries.length, 0, '不能命中其他行');
S.data.genes = Array.from({ length: 150 }, (_, i) => ({ ...gene, name: 'g' + i }));
assert.equal(compare(225).entries.length, 150, '不得静默截断候选');
S.data.genes = [{ ...gene, expanded: true, tx: [tx] }];
assert.deepEqual(compare(225).entries.map(e => e.txId), ['tx1'], '单转录本展开不应漏命中');
S.data.genes = [{ ...gene, expanded: true, tx: [tx, tx2] }];
assert.deepEqual(compare(225, 39, 36).entries.map(e => e.txId), ['tx1']);
assert.deepEqual(compare(225, 61, 56).entries.map(e => e.txId), ['tx2'], '展开模式只选择点击行');
assert.equal(compare(150, 61, 56).entries.length, 0, '展开模式不回退到其他转录本');
S.data.genes = [{ ...gene, expanded: true, tx: [{ ...tx, name: 'offscreen', start: -900, end: -800 }, tx] }];
updatePlaced();
assert.deepEqual(plain(api.geneDetailsAt(225, 36, track, 0)).entries.map(e => e.txId), ['tx1'], '导入轨道展开行按过滤后的rows选择');

S.data.genes = [{ ...gene, chrom: 'chr2', start: 1100, end: 1600, tx: [{ ...tx, start: 1100, end: 1600, exons: [[1100, 1600]], cdsStart: 1200, cdsEnd: 1500 }] }];
api.withPanel(1, () => updatePlaced(1));
const pane = {
  dataset: { p: '1' }, querySelector: () => ({}),
  getBoundingClientRect: () => ({ left: 50, top: 100, width: 1000, height: 100 }),
};
const event = { clientX: 275.75, clientY: 116, target: { closest: selector => selector === '.pane' ? pane : null } };
const splitDetail = api.geneDetailsForEvent(event, track);
assert.equal(splitDetail.bp, 1225);
assert.equal(splitDetail.chrom, 'chr2');
assert.equal(splitDetail.entries[0].txId, 'tx1');
assert.equal(S.act, 0, '非活动屏右键详情不得切换活动屏');
assert.equal(api.geneDetailsForEvent({ ...event, clientX: 49 }, track), null);
assert.equal(api.geneDetailsForEvent({ ...event, target: { closest: () => null } }, track), null, '标签区域只显示设置');

function allText(node) { return [node.textContent, ...node.children.map(allText)].join('\n'); }
const hostile = '<img src=x onerror=alert(1)>';
const detail = { chrom: 'chr1', bp: 219, entries: [{ ...api.geneFeatureDetails(gene, tx, 220), geneName: hostile }] };
for (lang of ['zh', 'en']) {
  const pop = element('div');
  api.renderGeneDetails(pop, detail);
  const text = allText(pop);
  assert(text.includes(hostile), '用户基因名作为纯文本显示');
  assert(text.includes('chr1:220'), '鼠标位置转为1基');
  assert(text.includes('chr1:221–250'), '片段区间转为含染色体的1基闭区间');
  assert(text.includes('30 bp'));
  if (lang === 'en') {
    assert(!/[\u3400-\u9fff]/u.test(text), '英文详情不得残留中文');
    assert(text.includes('CDS segment: 1 of 3'));
  } else assert(text.includes('CDS 片段: 第 1 个 / 共 3 个'));
  const intronPop = element('div');
  api.renderGeneDetails(intronPop, { chrom: 'chr1', bp: 150, entries: [api.geneFeatureDetails(gene, tx, 150)] });
  const intronText = allText(intronPop);
  assert(intronText.includes('chr1:151–200'));
  assert(intronText.includes(lang === 'en' ? 'Intron: 1 of 4' : '内含子: 第 1 个 / 共 4 个'));
  assert(intronText.includes('50 bp'));
  const hover = api.geneFeatureHoverText({ chrom: 'chr1', bp: 150, entries: [api.geneFeatureDetails(gene, tx, 150)] });
  assert(hover.includes('chr1:151–200') && hover.includes('50 bp'));
  assert(intronText.includes(lang === 'en' ? 'All introns' : '全部内含子'));
  assert(intronText.includes('chr1:451–500'), '全部内含子清单包含未命中的intron');
  const negativeIntrons = api.geneFeatureDetails({ ...gene, strand: '-' }, tx, 110).introns;
  assert.equal(negativeIntrons[0].number, 1);
  assert.equal(negativeIntrons[0].start, 450);
  const list = pop.children.find(node => node.style.cssText?.includes('overflow:auto'));
  assert(list, '所有候选使用滚动容器，不截断');
  const absent = element('div');
  api.renderGeneDetails(absent, null);
  assert.equal(absent.children.length, 0, '齿轮设置无详情参数时保持原状');
  const empty = element('div');
  api.renderGeneDetails(empty, { chrom: 'chr1', bp: 0, entries: [] });
  assert(allText(empty).includes(lang === 'en' ? 'No gene feature' : '未命中基因'));
}
// Real popup drag handler: title only, pointer capture, viewport clamp, once.
const events = {};
const header = {};
let captured = null;
const popup = {
  style: {},
  addEventListener(name, handler) { (events[name] || (events[name] = [])).push(handler); },
  contains: node => node === header,
  getBoundingClientRect: () => ({ left: 100, top: 80, width: 280, height: 400 }),
  setPointerCapture: id => { captured = id; },
  hasPointerCapture: id => captured === id,
  releasePointerCapture: () => { captured = null; },
};
const dragContext = vm.createContext({ window: { innerWidth: 1000, innerHeight: 700 } });
vm.runInContext(source('bindTrackPopDrag'), dragContext);
dragContext.bindTrackPopDrag(popup); dragContext.bindTrackPopDrag(popup);
assert.equal(events.pointerdown.length, 1);
const pointer = (x, y, title = true) => ({ button: 0, pointerId: 5, clientX: x, clientY: y,
  target: { closest: () => title ? header : null }, preventDefault() {}, stopPropagation() {} });
events.pointerdown[0](pointer(120, 100));
events.pointermove[0](pointer(320, 250));
assert.equal(popup.style.left, '300px'); assert.equal(popup.style.top, '230px');
events.pointermove[0](pointer(-100, -100));
assert.equal(popup.style.left, '8px'); assert.equal(popup.style.top, '8px');
events.pointerup[0](pointer(0, 0)); assert.equal(captured, null);
events.pointerdown[0](pointer(120, 100, false));
events.pointermove[0](pointer(500, 500));
assert.equal(popup.style.left, '8px', '输入/正文区域不能触发拖动');

assert(app.includes("trk.dataset.track === 'genes' ? geneDetailsForEvent(e) : null"));
assert(app.includes("'lgenes', t.id, geneDetailsForEvent(e, t)"));
console.log('基因详情测试通过：正负链、CDS/UTR片段、半开端点、非编码、重叠候选、展开行、分屏、中英及安全DOM。');
