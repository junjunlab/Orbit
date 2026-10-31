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
  await sleep(2000);
  const tid = await ev(`(() => { const t = (window.__igv.S.bw.list||[]).filter(x=>x.heatmap).pop(); return t ? t.id : null; })()`);
  await ev(`(() => { const S=window.__igv.S; S.bw.on['${tid}']=true; window.__igv.loadBwTracks && window.__igv.loadBwTracks(); })()`);
  await sleep(2500);
  await ev(`document.querySelector('.track[data-bw="${tid}"] .tgear').click()`);
  await sleep(600);
  await ev(`(() => { const cbs=document.querySelectorAll('.tpop .smp input'); cbs[1].click(); cbs[5].click(); })()`);
  await sleep(1000);
  console.log('设置后:', await ev(`document.querySelector('.track[data-bw="${tid}"] .sub').textContent`));
  await ev(`document.querySelector('#tpop .foot .btn.pri').click()`);
  await sleep(500);
  // 重开页面
  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(3000);
  await ev(`(() => { const S=window.__igv.S; S.bw.on['${tid}']=true; window.__igv.loadBwTracks && window.__igv.loadBwTracks(); })()`);
  await sleep(2500);
  console.log('重开后:', await ev(`document.querySelector('.track[data-bw="${tid}"] .sub').textContent`),
    '| segHide:', await ev(`JSON.stringify((window.__igv.S.bw.cfg['${tid}']||{}).segHide)`),
    '| sidebar:', await ev(`document.querySelector('.bw-trk .nm').textContent`));
  // 清理：恢复全选
  await ev(`(() => { const S=window.__igv.S; S.bw.cfg['${tid}']=Object.assign({}, S.bw.cfg['${tid}'],{segHide:[]}); })()`);
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
