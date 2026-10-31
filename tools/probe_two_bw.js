const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'http://127.0.0.1:8799/?db=hg38&locus=chr1:55,000,000-62,000,000';
(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false });
  const ev = async (e) => {
    const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(3000);
  console.log('状态:', JSON.stringify(await ev(`(() => {
    const S = window.__igv.S;
    return { list: S.bw.list.map(t => ({ id: t.id, loaded: !!t.loaded, fmt: t.format })),
      on: Object.fromEntries(S.bw.list.map(t => [t.id, !!S.bw.on[t.id]])),
      onSaved: S.bw.onSaved,
      rows: [...document.querySelectorAll('#view .track[data-bw]')].map(el => ({
        id: el.dataset.bw, hidden: el.hidden, h: (el.querySelector('canvas')||{}).style.height })) };
  })()`), null, 1));
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
