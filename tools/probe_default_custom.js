const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = async (e) => {
    const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 200) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8799/' });
  for (let i = 0; i < 150 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(3500);
  console.log('默认装配:', JSON.stringify(await ev(`(() => { const S=window.__igv.S; return { custom: !!S.asm.custom, id: S.asm.id, label: document.getElementById('asmName').textContent, chroms: Object.keys(S.asm.chroms||{}).length, tracks: (S.bw.list||[]).map(t=>t.id) }; })()`)));
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
