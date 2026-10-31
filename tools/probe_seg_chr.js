// 整条染色体热图：数据范围、空 bin、截图
const fs = require('fs');
const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:8799/?db=hg38&locus=';
const OUT = 'C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.4/tools/';
(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false });
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const dump = async (tag) => {
    const o = await ev(`(() => {
      const S = window.__igv.S;
      const t = (S.bw.list||[]).filter(x=>x.heatmap).pop();
      const d = S.bw.data[t.id] || {};
      const rows = d.rows || [];
      const nulls = rows.length ? rows[0].filter(v => v == null).length : -1;
      return { view: S.view.chrom + ':' + S.view.start + '-' + S.view.end,
        start: d.start, end: d.end, bins: d.bins, nulls,
        lastData: rows.length ? rows[0].length - 1 - [...rows[0]].reverse().findIndex(v => v != null) : -1 };
    })()`);
    console.log(tag, JSON.stringify(o));
  };
  await cdp.send('Page.navigate', { url: BASE + 'chr6:55,000,000-62,000,000' });
  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(2500);
  const tid = await ev(`(() => { const t = (window.__igv.S.bw.list||[]).filter(x=>x.heatmap).pop(); return t ? t.id : null; })()`);
  await ev(`(() => { const S=window.__igv.S; S.bw.on['${tid}']=true; window.__igv.loadBwTracks && window.__igv.loadBwTracks(); })()`);
  await sleep(2500);
  await dump('局部:');
  await ev(`window.__igv.navigate('chr6', 0, 170805979)`);
  await sleep(3000);
  await dump('整条:');
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '_seg_chr6_full.png', Buffer.from(s.result.data, 'base64'));
  // 再切 chr1 整条，验证换染色体不串数据
  await ev(`window.__igv.navigate('chr1', 0, 248956422)`);
  await sleep(3000);
  await dump('chr1 整条:');
  const s2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '_seg_chr1_full.png', Buffer.from(s2.result.data, 'base64'));
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
