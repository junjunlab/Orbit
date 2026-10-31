// 综合回归：基因折叠模式切换 + 染色体下拉 + 全基因组视野 + SEG 布局 + 删除
const fs = require('fs');
const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'http://127.0.0.1:8799/?db=hg38&locus=chr1:10,000,000-200,000,000';
const OUT = 'C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.4/tools/';

(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false });
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 400) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async (name) => {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + name, Buffer.from(s.result.data, 'base64'));
  };

  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(2500);
  await ev(`window.confirm = () => true`);

  console.log('1 折叠为一行:', await ev(`(() => {
    const lay = window.__igv.geneLayout();
    return JSON.stringify({ rows: lay.maxRows, genes: lay.count, canvasH: document.querySelector('.track[data-track="genes"] canvas').style.height });
  })()`));

  // 齿轮 → 分行排布
  await ev(`document.querySelector('.track[data-track="genes"] .tgear').click()`);
  await sleep(500);
  console.log('2 浮层按钮:', await ev(`[...document.querySelectorAll('#tpop .btn')].map(b => b.textContent).join('|')`));
  await ev(`(() => { const b = [...document.querySelectorAll('#tpop .btn')].find(x => x.textContent === '分行排布'); b && b.click(); })()`);
  await sleep(900);
  console.log('3 分行排布:', await ev(`(() => {
    const lay = window.__igv.geneLayout();
    return JSON.stringify({ rows: lay.maxRows, canvasH: document.querySelector('.track[data-track="genes"] canvas').style.height, collapsed: window.__igv.S.geneCollapsed });
  })()`));
  await shot('_gene_pack.png');

  // 回到折叠
  await ev(`(() => { const b = [...document.querySelectorAll('#tpop .btn')].find(x => x.textContent === '折叠一行'); b && b.click(); })()`);
  await sleep(800);
  console.log('4 回到折叠:', await ev(`(() => { const lay = window.__igv.geneLayout(); return JSON.stringify({ rows: lay.maxRows, collapsed: window.__igv.S.geneCollapsed }); })()`));
  await ev(`(() => { const p = document.querySelector('#tpop'); if (p) p.hidden = true; })()`);
  await shot('_gene_collapsed.png');

  // 染色体下拉：chr3
  await ev(`document.querySelector('#chromSel').click()`);
  await sleep(300);
  console.log('5 下拉项数:', await ev(`document.querySelectorAll('#chromMenu .scope-item').length`));
  await ev(`(() => { const it = [...document.querySelectorAll('#chromMenu .scope-item')].find(e => e.dataset.chrom === 'chr3'); it.click(); })()`);
  await sleep(2000);
  console.log('6 选中 chr3:', await ev(`JSON.stringify({ chrom: window.__igv.S.view.chrom, len: window.__igv.S.view.end, label: document.querySelector('#chromSelLabel').textContent })`));

  // 全部 → 全基因组
  await ev(`document.querySelector('#chromSel').click()`);
  await sleep(250);
  await ev(`(() => { const it = [...document.querySelectorAll('#chromMenu .scope-item')].find(e => e.dataset.chrom === '*'); it.click(); })()`);
  await sleep(900);
  console.log('7 全基因组:', await ev(`JSON.stringify({ on: window.__igv.S.genomeView, slots: (window.__igv.S._gvSlots||[]).length })`));
  await shot('_gv_view2.png');

  // 回到 chr1 并打开 SEG
  await ev(`document.querySelector('#chromSel').click()`);
  await sleep(250);
  await ev(`(() => { const it = [...document.querySelectorAll('#chromMenu .scope-item')].find(e => e.dataset.chrom === 'chr1'); it.click(); })()`);
  await sleep(1500);
  await ev(`(() => { const S = window.__igv.S; const t = (S.bw.list||[]).filter(x=>x.heatmap).pop(); if (t) { S.bw.on[t.id] = true; window.__igv.render(); } })()`);
  await sleep(2500);
  console.log('8 SEG 样本名列宽:', await ev(`(() => {
    const S = window.__igv.S; const t = (S.bw.list||[]).filter(x=>x.heatmap).pop();
    return t ? t.id + ' | layout=' + (S.bw.cfg[t.id]||{}).segLayout : 'none';
  })()`));
  await shot('_seg_row2.png');

  console.log('errors:', await ev(`(async () => {
    const r = await fetch('/api/clientlog').catch(() => null); return r ? 'see data/client.log' : 'n/a';
  })()`));
  await cdp.close();
})();
