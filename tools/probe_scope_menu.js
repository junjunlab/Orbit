// 搜索范围下拉（自绘菜单）冒烟：
//   打开菜单 → 悬停第 2 项 → 截图，检查高亮是不是深灰、选中项是否可区分
// 用法：node tools/probe_scope_menu.js [url] [out.png]
const fs = require('fs');
const path = require('path');
const { connect } = require('../../igv_0.3/tools/cdp');

const URL_ = process.argv[2] || 'http://127.0.0.1:8797/?db=hg38';
const OUT = process.argv[3] || path.join(__dirname, '_scope_menu.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await cdp.send('Page.navigate', { url: URL_ });

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);

  // 先导入一个 GTF，否则下拉里只有「内置」一项（禁用态）
  const gtf = path.resolve(__dirname, '../../igv_0.3/data/samples/demo_genes.gtf');
  if (fs.existsSync(gtf) && (await ev("document.querySelectorAll('#scopeMenu .scope-item').length")) < 2) {
    const doc = await cdp.send('DOM.getDocument', { depth: -1 });
    const node = await cdp.send('DOM.querySelector',
      { nodeId: doc.result.root.nodeId, selector: '#fileInput' });
    await cdp.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [gtf] });
    console.log('imported', gtf);
  }
  for (let i = 0; i < 80 && (await ev("document.querySelectorAll('#scopeMenu .scope-item').length")) < 2; i++) await sleep(200);

  const info = await ev(`(() => {
    const btn = document.getElementById('scopeBtn');
    const r = btn.getBoundingClientRect();
    return { label: document.getElementById('scopeLabel').textContent,
             disabled: btn.disabled,
             items: [...document.querySelectorAll('#scopeMenu .scope-item')].map(e => e.textContent),
             cur: [...document.querySelectorAll('#scopeMenu .scope-item.cur')].map(e => e.textContent),
             rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  })()`);
  console.log('before:', JSON.stringify(info));

  const click = async (x, y) => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  await click(info.rect.x + info.rect.w / 2, info.rect.y + info.rect.h / 2);
  await sleep(300);

  const open = await ev(`(() => {
    const m = document.getElementById('scopeMenu');
    const it = m.querySelectorAll('.scope-item')[1];
    const r = it ? it.getBoundingClientRect() : null;
    return { hidden: m.hidden, count: m.querySelectorAll('.scope-item').length,
             item2: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null };
  })()`);
  console.log('open:', JSON.stringify(open));

  // 真实鼠标移动 → 触发 :hover
  if (open.item2) {
    const p = { x: open.item2.x + open.item2.w / 2, y: open.item2.y + open.item2.h / 2 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x - 20, y: p.y - 20 });
    await sleep(60);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await sleep(250);
    const bg = await ev(`(() => {
      const it = document.querySelectorAll('#scopeMenu .scope-item')[1];
      const cs = getComputedStyle(it);
      return { bg: cs.backgroundColor, fg: cs.color, hovered: it.matches(':hover') };
    })()`);
    console.log('hover:', JSON.stringify(bg));
  }

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const b64 = shot && shot.result && shot.result.data;
  if (!b64) console.log('shot failed:', JSON.stringify(shot).slice(0, 200));
  else { fs.writeFileSync(OUT, Buffer.from(b64, 'base64')); console.log('saved', OUT); }

  // 点第 2 项 → 应切到该范围并关闭菜单
  if (open.item2) {
    await click(open.item2.x + open.item2.w / 2, open.item2.y + open.item2.h / 2);
    await sleep(400);
    const after = await ev(`({
      hidden: document.getElementById('scopeMenu').hidden,
      label: document.getElementById('scopeLabel').textContent,
      cur: [...document.querySelectorAll('#scopeMenu .scope-item.cur')].map(e => e.textContent),
      focusOnInput: document.activeElement && document.activeElement.id
    })`);
    console.log('after pick:', JSON.stringify(after));
  }

  // 深色主题再看一眼：hover 的深灰不能糊在深色背景里
  await ev("document.body.dataset.theme = 'dark'");
  await sleep(200);
  const b2 = await ev(`(() => { const r = document.getElementById('scopeBtn').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await click(b2.x, b2.y);
  await sleep(250);
  const it2 = await ev(`(() => { const it = document.querySelectorAll('#scopeMenu .scope-item')[1];
    const r = it.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: it2.x, y: it2.y });
  await sleep(250);
  console.log('dark hover:', JSON.stringify(await ev(`(() => { const it = document.querySelectorAll('#scopeMenu .scope-item')[1];
    const cs = getComputedStyle(it); return { bg: cs.backgroundColor, fg: cs.color }; })()`)));
  const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const b642 = shot2 && shot2.result && shot2.result.data;
  if (b642) {
    const out2 = OUT.replace(/\.png$/, '_dark.png');
    fs.writeFileSync(out2, Buffer.from(b642, 'base64'));
    console.log('saved', out2);
  }

  await cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
