const fs = require('fs');
const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.4/tools/';
(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = async (e) => {
    const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 400) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8799/?db=hg38&locus=chr1:55,000,000-62,000,000' });
  for (let i = 0; i < 150 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(6000);
  console.log('SEG 状态:', JSON.stringify(await ev(`(() => {
    const S = window.__igv.S;
    const t = (S.bw.list||[]).find(x=>x.heatmap);
    if (!t) return 'no seg';
    const d = S.bw.data[t.id] || {};
    const el = document.querySelector('.track[data-bw="'+t.id+'"]');
    const cfg = S.bw.cfg[t.id] || {};
    return { id: t.id, rows: (d.rows||[]).length, bins: d.bins, start: d.start, end: d.end,
      cfg: { layout: cfg.segLayout, names: cfg.segNames, hide: cfg.segHide },
      canvasH: el && el.querySelector('canvas').style.height,
      sub: el && el.querySelector('.sub').textContent,
      nameRows: el ? el.querySelectorAll('.seg-sample-name').length : 0 };
  })()`)));
  let s = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '_now_local.png', Buffer.from(s.result.data, 'base64'));
  await ev(`window.__igv.pickChrom('chr1')`);
  await sleep(4000);
  s = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '_now_whole.png', Buffer.from(s.result.data, 'base64'));
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
