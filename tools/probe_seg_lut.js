const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'http://127.0.0.1:8799/?db=hg38&locus=chr1:55,000,000-62,000,000';
(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false });
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(2500);
  const tid = await ev(`(() => { const t = (window.__igv.S.bw.list||[]).filter(x=>x.heatmap).pop(); return t ? t.id : null; })()`);
  await ev(`(() => { const S=window.__igv.S; S.bw.on['${tid}']=true; window.__igv.loadBwTracks && window.__igv.loadBwTracks(); })()`);
  await sleep(2500);
  const out = await ev(`(() => {
    const S = window.__igv.S, d = S.bw.data['${tid}'];
    const rows = d.rows || [];
    const per = rows.map((r, i) => {
      let mn = Infinity, mx = -Infinity, s = 0, nz = 0;
      for (const v of r) { if (v == null) continue; if (v < mn) mn = v; if (v > mx) mx = v; s += Math.abs(v); if (Math.abs(v) > 0.01) nz++; }
      return { i, mn: +mn.toFixed(3), mx: +mx.toFixed(3), meanAbs: +(s / r.length).toFixed(4), nz };
    });
    return { trackName: (S.bw.list.find(x => x.id === '${tid}') || {}).name,
      sampleNames: d.samples || d.names || null, nRows: rows.length, bins: d.bins, per };
  })()`);
  console.log(JSON.stringify(out, null, 1).slice(0, 4000));
  cdp.close();
})().catch(e => { console.error(e); process.exit(1); });
