// 检查 SEG 热图数据：每个样本的非空 bin 比例，判断转置视图的白缝是数据缺失还是绘制问题
const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'http://127.0.0.1:8799/?db=hg38&locus=chr1:55,000,000-62,000,000';

(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
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
  const info = await ev(`(() => {
    const d = window.__igv.S.bw.data['${tid}'];
    if (!d) return 'no data';
    const rows = d.rows || [];
    return { start: d.start, end: d.end, bins: d.bins, nRows: rows.length,
      names: (d.names||[]).slice(0,12),
      lens: rows.map(r => r.length),
      nn: rows.map(r => r.filter(v => v != null).length),
      firstNulls: rows.map(r => { const idx=[]; for(let i=0;i<r.length;i++) if(r[i]==null) idx.push(i); return idx.length; }) };
  })()`);
  console.log(JSON.stringify(info, null, 1).slice(0, 3000));
  cdp.close();
})().catch(e => { console.error(e); process.exit(1); });
