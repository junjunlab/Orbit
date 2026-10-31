'use strict';
// 英文界面残留中文的守门测试：把 app.js 里所有含中文的 T(...) 字面量过一遍
// 运行时翻译函数，只要输出还带汉字就算漏翻（1.0.1 里 "轨道分组" 就是这么漏的）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../src/web/i18n.js'), 'utf8');
const window = {};
const document = {
  readyState: 'loading', addEventListener() {}, getElementById: () => null,
  documentElement: {}, body: null, title: '',
};
vm.runInNewContext(src, { window, document, localStorage: { getItem: () => 'en' } });
const t = window.I18N.t;

const app = fs.readFileSync(path.join(__dirname, '../src/web/app.js'), 'utf8');
const CJK = /[\u4e00-\u9fa5]/;
const lits = new Set();
const unesc = (v) => v.replace(/\\n/g, '\n').replace(/\\'/g, "'");
for (const m of app.matchAll(/T\(\s*'([^']*[\u4e00-\u9fa5][^']*)'/g)) lits.add(unesc(m[1]));
// 模板字面量要么拼 HTML，要么带 ${} 插值——都得靠 RULES 在运行时匹配，
// 这里跳过，改由下面的 dynamic 列表点名覆盖。
for (const m of app.matchAll(/T\(\s*`([^`]*[\u4e00-\u9fa5][^`]*)`/g)) {
  if (!/[<>]/.test(m[1]) && !m[1].includes('${')) lits.add(unesc(m[1]));
}

const leaks = [...lits].filter((s) => CJK.test(t(s)));
assert.equal(leaks.length, 0, '英文界面仍有中文：\n' + leaks.join('\n'));

// 动态拼接的句子单独点名，避免以后改模板时静默漏翻
const dynamic = [
  '载入 120 ms', '当前 3 屏 · 每屏可独立导航', '2 屏', '位图 2×',
  '12 个基因', '157 条 read', '18 个剪接位点', '已导出 PNG（1200×800）',
  '已导出矢量 SVG（1200×800，120 个图元）', '已导出矢量 PDF（1200×800，51 KB）',
  'hg38 · 3.10 Gb · 24 条染色体 · 点染色体看整条',
  '仅显示前 500 个基因，请放大查看', '行 16–39 / 157 · 滚轮上下浏览',
  '第 1 个 / 共 12 个', '第 11 个 / 共 11 个', '内含子', '外显子', 'CDS 片段', '3′ UTR 片段',
  '已挂载 foo.bam', '轨道分组', '本组 3 条轨道；开启后取组内最大范围统一缩放。',
  '已隐藏 2 条 · 点此恢复', '已选 3 条信号轨道', '统一颜色 · 3 条轨道',
  '删除选中的 3 条轨道', '已删除 3 条信号轨道', '12 个剪接位点',
  '仅返回 500 / 1000 条（达到上限）', '24 条染色体', '上传中 45% · 12.3 MB',
  ' · 10 个样本', ' · 1,234 个区间', '导入 2 个，失败：a；b', '已导入 2 个文件',
  '已选 2 条导入轨道', '已删除 2 条导入轨道', '1,234 个 · 密度', '≥ 500 个基因',
  '互补链 · 120 bp', '确定删除选中的 3 条信号轨道？\n· a\n· b',
  '确定删除选中的 2 条导入轨道？\n· a\n\n对应文件会从 data/loaded 中删除。',
];
const dynLeaks = dynamic.filter((s) => CJK.test(t(s)));
assert.equal(dynLeaks.length, 0, '动态文案仍有中文：\n' + dynLeaks.join('\n'));

console.log(`英文界面守门通过：${lits.size} 条静态文案 + ${dynamic.length} 条动态文案无中文残留。`);
