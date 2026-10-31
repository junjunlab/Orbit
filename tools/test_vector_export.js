'use strict';
// 矢量导出回归：剪接弧用的是 bezierCurveTo，记录器缺这个方法时整份 SVG/PDF
// 会以 "ctx.bezierCurveTo is not a function" 失败（1.0.1 的真实缺陷）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../src/web/vexport.js'), 'utf8');
const window = {};
// 模块加载时会建一块离屏 canvas 量文字宽度，这里给个最小桩
const document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ font: '', measureText: (t) => ({ width: String(t).length * 6 }) }),
  }),
};
vm.runInNewContext(src, { window, document, console, Math, Map, Set, TextEncoder, TextDecoder, Blob: class {} });
const { Rec, toSVG } = window.VEX;

const rec = new Rec();
rec.beginPath();
rec.moveTo(10, 10);
rec.bezierCurveTo(40, 0, 80, 0, 110, 10);   // 上弧
rec.quadraticCurveTo(60, 30, 10, 10);       // 下弧（二次转三次）
rec.closePath();
rec.fillStyle = '#cf6b6b';
rec.fill();
assert.equal(rec.path.length, 4, '路径应有 M + C + C + Z 四段');
assert.equal(JSON.stringify(rec.path.map((s) => s[0])), JSON.stringify(['M', 'C', 'C', 'Z']));
assert.equal(rec.path[1].length, 7, 'C 段应有 6 个坐标');
assert.equal(rec.ops.length, 1);

// 二次贝塞尔要转成三次，且端点保持原样
const q = new Rec();
q.beginPath();
q.moveTo(0, 0);
q.quadraticCurveTo(30, 30, 60, 0);
assert.equal(JSON.stringify(q.path[1]), JSON.stringify(['C', 20, 20, 40, 20, 60, 0]));

// 生成的 SVG 必须包含 C 指令，且不出现 NaN
const svg = toSVG(rec.ops, 200, 100, { title: 't' });
assert(svg.includes('<path'), 'SVG 应有路径');
assert(/d="[^"]*C/.test(svg), 'SVG 路径应含三次贝塞尔 C 指令');
assert(!/NaN|Infinity/.test(svg), 'SVG 不得出现 NaN/Infinity');

// 圆弧内部同样靠 C 段拼出来，顺带确认 arc 没退化
const a = new Rec();
a.beginPath();
a.arc(50, 50, 20, 0, Math.PI * 1.5);
a.strokeStyle = '#333';
a.stroke();
assert(a.path.every((s) => s[0] !== 'A'), '圆弧应离散成 C 段');

console.log('矢量导出测试通过：bezierCurveTo / quadraticCurveTo 记录为 C 段，SVG 无 NaN，圆弧离散正常。');
