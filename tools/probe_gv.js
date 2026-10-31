// 验证：①基因轨道默认折叠为一行 ②染色体下拉选整条 ③「全部染色体」→ 全基因组视野
const fs = require('fs');
const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'http://127.0.0.1:8799/?db=hg38&locus=chr1:10,000,000-200,000,000';

(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false });
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 500) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(2500);

  console.log('errors:', await ev(`JSON.stringify(window.__errs || [])`));
  console.log('geneCollapsed:', await ev(`window.__igv.S.geneCollapsed`));
  console.log('gene layout:', await ev(`(() => {
    const lay = window.__igv.geneLayout();
    return JSON.stringify({ genes: lay.count, rows: lay.maxRows, placed: lay.placed.length });
  })()`));
  console.log('genes canvas h:', await ev(`document.querySelector('.track[data-track="genes"] canvas').style.height`));
  console.log('chromSel label:', await ev(`document.querySelector('#chromSelLabel').textContent`));
  console.log('chrom menu items:', await ev(`(() => {
    document.querySelector('#chromSel').click();
    const m = document.querySelector('#chromMenu');
    const items = [...m.querySelectorAll('.scope-item')];
    return JSON.stringify({ hidden: m.hidden, n: items.length, first: items[0] && items[0].textContent.trim(), second: items[1] && items[1].textContent.trim() });
  })()`));
  await sleep(300);
  const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.4/tools/_gv_menu.png', Buffer.from(shot1.result.data, 'base64'));

  // 点 chr2 → 整条染色体
  await ev(`(() => { const it = [...document.querySelectorAll('#chromMenu .scope-item')].find(e => e.dataset.chrom === 'chr2'); it && it.click(); })()`);
  await sleep(2500);
  console.log('after pick chr2:', await ev(`JSON.stringify({ chrom: window.__igv.S.view.chrom, start: window.__igv.S.view.start, end: window.__igv.S.view.end, label: document.querySelector('#chromSelLabel').textContent })`));

  // 全部染色体 → 全基因组视野
  await ev(`(() => { document.querySelector('#chromSel').click(); })()`);
  await sleep(300);
  await ev(`(() => { const it = [...document.querySelectorAll('#chromMenu .scope-item')].find(e => e.dataset.chrom === '*'); it && it.click(); })()`);
  await sleep(1200);
  console.log('genome view:', await ev(`JSON.stringify({
    on: window.__igv.S.genomeView,
    slots: (window.__igv.S._gvSlots || []).length,
    gvHidden: document.querySelector('.track[data-track="genome"]').hidden,
    ideoHidden: document.querySelector('.track[data-track="ideogram"]').hidden,
    label: document.querySelector('#chromSelLabel').textContent,
    st: document.querySelector('#stLocus').textContent + ' | ' + document.querySelector('#stWindow').textContent + ' | ' + document.querySelector('#stScale').textContent,
    canvasH: document.querySelector('.track[data-track="genome"] canvas').style.height,
  })`));
  const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.4/tools/_gv_view.png', Buffer.from(shot2.result.data, 'base64'));

  // 点 chr7 进入该条
  const box = await ev(`(() => {
    const s = (window.__igv.S._gvSlots || []).find(x => x.name === 'chr7');
    if (!s) return null;
    const r = document.querySelector('.track[data-track="genome"] canvas').getBoundingClientRect();
    return JSON.stringify({ x: r.left + s.x + s.w / 2, y: r.top + r.height / 2 });
  })()`);
  console.log('chr7 box:', box);
  if (box) {
    const p = JSON.parse(box);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await sleep(2000);
    console.log('after click chr7:', await ev(`JSON.stringify({ gv: window.__igv.S.genomeView, chrom: window.__igv.S.view.chrom, start: window.__igv.S.view.start, end: window.__igv.S.view.end, ideoHidden: document.querySelector('.track[data-track="ideogram"]').hidden })`));
  }
  await cdp.close();
})();
