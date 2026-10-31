// Test IGV-style transcript expansion via CDP.
//   node tools/test_expand.js
// Chrome：有 9222 就复用，没有就由 tools/cdp.js 自动拉一个无头实例（结束时关掉）。
const fs = require('fs');
const { connect } = require('./cdp');

const PORT = process.env.IGV_TEST_PORT || '8799';
const URL = `http://localhost:${PORT}/?db=hg38&locus=chr8:127735000-127743000`;
const OUT = process.argv[2] || 'tools/_expand.png';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cdp = await connect();
  const send = cdp.send;

  await send('Page.enable');
  await send('Page.navigate', { url: URL });

  // wait for the app + debug hook
  for (let i = 0; i < 80; i++) {
    const r = await send('Runtime.evaluate', { expression: '!!(window.__igv && window.__igv.S && window.__igv.S.data.genes)' });
    if (r.result && r.result.result && r.result.result.value) break;
    await sleep(250);
  }

  const expr = `(async () => {
    const I = window.__igv;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 80 && !(I.S.data.genes && I.S.data.genes.length); i++) await wait(100);
    if (!I.S.data.genes.length) return { ok:false, reason:'no genes loaded', chrom:I.S.view.chrom };
    // precondition: start from a collapsed, unselected state (the expanded set
    // is persisted in localStorage, so a previous test run may have left it on)
    I.S.expanded.clear(); I.S.sel = null; I.scheduleRender();
    await wait(120);
    // prefer MYC, else any multi-transcript gene currently laid out in view
    let g = I.S.data.genes.find(x => x.name === 'MYC' && x.chrom === I.S.view.chrom);
    if (!g) {
      const vis = I.geneLayout().placed.filter(p => p.g.tx.length > 1)
        .sort((a,b) => b.g.tx.length - a.g.tx.length);
      g = vis.length ? vis[0].g : null;
    }
    if (!g) return { ok:false, reason:'no multi-tx gene in view', sample:I.S.data.genes.slice(0,8).map(x=>x.name+':'+x.tx.length) };
    const before = I.geneLayout();
    const bEntry = before.placed.find(p => p.g === g);
    const bSpan = bEntry ? bEntry.span : null;
    const bRows = before.maxRows;
    I.S.sel = g; I.renderInfo();   // mirror real flow: gene is selected before/at expand
    I.toggleExpand(g);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await wait(80);
    const after = I.geneLayout();
    const aEntry = after.placed.find(p => p.g === g);
    const aSpan = aEntry ? aEntry.span : null;
    const aRows = after.maxRows;
    const toggles = (I.S._geneToggles || []).filter(t => t.key === I.geneKey(g)).length;
    return {
      ok:true, gene:g.name, chrom:g.chrom, txCount:g.tx.length,
      bSpan, aSpan, bRows, aRows,
      expanded:I.isExpanded(g), toggles,
      spanMatchesTx: aSpan === g.tx.length,
      rowsIncreased: aRows >= bRows + (g.tx.length - 1) || aSpan === g.tx.length,
      selRect: I.S.sel && I.S.sel.name === g.name
    };
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  let report;
  if (r.result && r.result.exceptionDetails) {
    console.error('JS error:', JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    process.exit(1);
  }
  report = r.result.result.value;
  console.log('REPORT', JSON.stringify(report, null, 2));

  // collapse again and verify it returns to single row
  const expr2 = `(async () => {
    const I = window.__igv;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const g = I.S.data.genes.find(x => x.name === '${report && report.gene}' && x.chrom === '${report && report.chrom}');
    if (!g) return { ok:false };
    I.toggleExpand(g);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await wait(80);
    const a = I.geneLayout().placed.find(p => p.g === g);
    return { ok:true, collapsedSpan: a ? a.span : null, expanded:I.isExpanded(g) };
  })()`;
  if (report && report.ok && report.gene) {
    const r2 = await send('Runtime.evaluate', { expression: expr2, awaitPromise: true, returnByValue: true });
    const rep2 = r2.result.result.value;
    console.log('COLLAPSE', JSON.stringify(rep2));
    report.collapsedSpan = rep2.collapsedSpan;
  }

  await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('wrote', OUT);

  // assertions
  const pass = report && report.ok && report.spanMatchesTx && report.expanded
    && report.toggles >= 1 && report.rowsIncreased && report.selRect
    && report.collapsedSpan === 1;
  console.log(pass ? 'RESULT PASS' : 'RESULT FAIL');
  await cdp.close();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
