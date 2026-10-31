const fs = require('fs');
const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'http://127.0.0.1:8799/?db=hg38&locus=chr1:1-248,956,422';
const OUT = 'C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.4/tools/';
(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = async (e) => {
    const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 150 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(6000);
  console.log('基因轨道:', JSON.stringify(await ev(`(() => {
    const S = window.__igv.S;
    const t = (S.loaded.list||[]).find(x => x.kind === 'gene');
    if (!t) return 'no gene track';
    const el = document.querySelector('.track[data-loaded="'+t.id+'"]');
    return { id: t.id, hidden: el && el.hidden, sub: el && el.querySelector('.sub') && el.querySelector('.sub').textContent,
      canvasH: el && el.querySelector('canvas').style.height };
  })()`)));
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '_gtf_whole.png', Buffer.from(s.result.data, 'base64'));
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
