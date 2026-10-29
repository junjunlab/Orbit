// 量 render() 的耗时：几个典型视野（字母模式 / 密集基因 / 整条染色体）
const { connect } = require('./cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCI = (process.env.IGV_LOCI || 'chr19:12791400-12791800,chr19:12700000-12900000,chr19:1-58617616').split(',');
(async () => {
  const cdp = await connect(); const { send } = cdp;
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result.result.value;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:8799/?db=hg38&locus=${LOCI[0]}` });
  await sleep(600); await ev('localStorage.clear();');
  for (const locus of LOCI) {
    await send('Page.navigate', { url: `http://127.0.0.1:8799/?db=hg38&locus=${locus}` });
    for (let i = 0; i < 160; i++) { if (await ev('!!(window.__igv && window.__igv.S.asm)')) break; await sleep(250); }
    await sleep(1800);
    console.log(locus, await ev(`(() => {
      const t = [];
      for (let k = 0; k < 21; k++) { const a = performance.now(); __igv.render(); t.push(performance.now() - a); }
      t.sort((a, b) => a - b);
      return JSON.stringify({ genes: __igv.geneLayout().placed.length,
        med: +t[10].toFixed(1), min: +t[0].toFixed(1), max: +t[20].toFixed(1) });
    })()`));
  }
  await cdp.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
