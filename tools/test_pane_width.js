'use strict';
// 回归：paneWidth 量不到宽度（clientWidth 为 0）时不能退化成 80 px 兜底。
// 1.0.2 之前返回 Math.max(80, 0) = 80，px() 会以为画布只有 80 px 宽，
// 把整条染色体的刻度与基因全挤在左边——自定义装配首次渲染就踩到过。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../src/web/app.js'), 'utf8');
function source(name) {
  const start = app.indexOf(`  function ${name}(`);
  assert(start >= 0, `应找到真实函数 ${name}`);
  let depth = 0, i = app.indexOf('{', start);
  for (; i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}') { depth--; if (!depth) break; }
  }
  return app.slice(start, i + 1);
}

let paneClientWidth = 0;
let bodyClientWidth = 0;
const sandbox = vm.createContext({
  Math,
  document: {
    querySelector: (sel) => (sel.includes('.pane') ? { clientWidth: paneClientWidth } : null),
  },
  visibleTrackBody: () => ({ clientWidth: bodyClientWidth }),
  S: { panels: [{}], act: 0 },
});
// let/_paneW 是模块作用域的，取不到属性；在同一上下文里包一层访问器
vm.runInContext(
  source('paneWidth') + '\n' + source('refreshPaneW') + '\n' + source('trackWidth') + '\n' +
  'globalThis.__t = { refresh: refreshPaneW, track: trackWidth,\n' +
  '  get paneW() { return _paneW.slice(); }, set paneW(v) { _paneW = v; } };',
  sandbox);
const ctx = { refreshPaneW: sandbox.__t.refresh, trackWidth: sandbox.__t.track,
  get _paneW() { return sandbox.__t.paneW; }, set _paneW(v) { sandbox.__t.paneW = v; } };

// 1) 正常有宽度
paneClientWidth = 1032; bodyClientWidth = 1032;
ctx.refreshPaneW();
assert.equal(ctx._paneW[0], 1032, '正常时取 pane 宽度');

// 2) pane 宽度为 0、body 有宽度 → 用 body，而不是 80
paneClientWidth = 0;
ctx.refreshPaneW();
assert.equal(ctx._paneW[0], 1032, 'pane 为 0 时应回落到 track-body 的宽度');

// 3) 两者都为 0（这一帧完全没布局）→ 沿用上一次的有效宽度
paneClientWidth = 0; bodyClientWidth = 0;
ctx.refreshPaneW();
assert.equal(ctx._paneW[0], 1032, '完全量不到时应保留上一次的有效宽度');

// 4) 关键回归：绝不能出现 80
paneClientWidth = 0; bodyClientWidth = 0;
ctx._paneW = [0];
ctx.refreshPaneW();
assert.notEqual(ctx._paneW[0], 80, '不得退化成 80 px 兜底');
assert.equal(ctx._paneW[0], 0, '没有历史值时保持 0，由 trackWidth() 再兜底');

// 5) trackWidth() 在 _paneW 为 0 时会现算
paneClientWidth = 900;
assert.equal(ctx.trackWidth(), 900, 'trackWidth 应在 _paneW 为空时现算');

console.log('面板宽度测试通过：pane 为 0 时回落到 body / 上次有效值，不再退化成 80 px。');
