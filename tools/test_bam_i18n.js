/* BAM i18n regression: execute the real i18n.js in a VM with mocked storage. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'web', 'i18n.js'), 'utf8');
const CJK = /[\u4e00-\u9fff]/;

function load(lang) {
  const store = new Map([['orbit.lang', lang]]);
  const document = {
    readyState: 'complete',
    title: 'Orbit',
    documentElement: { lang: 'zh' },
    body: null,
    addEventListener() {},
    getElementById() { return null; },
  };
  const context = {
    document,
    localStorage: {
      getItem(key) { return store.get(key) || null; },
      setItem(key, value) { store.set(key, String(value)); },
    },
    location: { reload() {} },
    console,
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'i18n.js' });
  return context.I18N;
}

const en = load('en');
assert.strictEqual(en.lang, 'en');

const cases = [
  ['实验类型', 'Experiment type'],
  ['自动识别', 'Auto-detect'],
  ['普通', 'Standard'],
  ['RNA', 'RNA'],
  ['第三代测序', 'Third-generation sequencing'],
  ['最大窗口（kb）', 'Maximum window (kb)'],
  ['默认', 'Default'],
  ['比对视图按链着色', 'Colour alignments by strand'],
  ['移除当前轨道', 'Remove current track'],
  ['仅隐藏当前子轨道，不删除 BAM 文件。', 'Hide this sub-track only; the BAM file is not deleted.'],
  ['恢复 Junctions 轨道', 'Restore Junctions track'],
  ['恢复 Alignments 轨道', 'Restore Alignments track'],
  ['剪接数据格式无效', 'Invalid junction data format'],
  ['读取中…', 'Loading…'],
  ['无碱基序列', 'no base sequence'],
  ['该区域没有比对记录', 'No alignments in this region'],
  ['放大查看剪接（Zoom in to see junctions）', 'Zoom in to see junctions'],
  ['放大查看比对记录（Zoom in to see alignments）', 'Zoom in to see alignments'],
  ['放大查看覆盖度（Zoom in to see coverage）', 'Zoom in to see coverage'],
  ['该 BAM 在 chr1 没有比对记录', 'This BAM has no alignments on chr1'],
  ['该 BAM 在 chr1 没有剪接记录', 'This BAM has no junctions on chr1'],
  ['没有剪接记录', 'No junctions'],
  ['没有剪接位点', 'No junctions'],
  ['123 条 read', '123 reads'],
  ['1,234 / 5,678 条 read', '1,234 / 5,678 reads'],
  ['仅返回 100 / 200 条（达到上限）', 'Returned only 100 / 200 reads (limit reached)'],
  ['行 1–20 / 100 · 滚轮上下浏览', 'Rows 1–20 / 100 · scroll up/down to browse'],
  ['20 个剪接位点', '20 junctions'],
  ['当前生效 300 kb；覆盖度、比对和剪接共用。留空按实验类型：普通 30、RNA 300、第三代 1000 kb；自动识别未知时按普通。',
    'Active: 300 kb; shared by coverage, alignments, and junctions. Leave blank to use experiment defaults: Standard 30, RNA 300, third-generation 1000 kb; unknown auto-detection uses Standard.'],
];
for (const [input, expected] of cases) {
  const actual = en.t(input);
  assert.strictEqual(actual, expected, `${input} -> ${actual}`);
  assert(!CJK.test(actual), `English translation still contains CJK: ${input} -> ${actual}`);
}

const zh = load('zh');
for (const [input] of cases) assert.strictEqual(zh.t(input), input, `Chinese changed: ${input}`);

console.log(`PASS: ${cases.length} BAM English translations and Chinese originals`);
