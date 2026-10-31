// 一次选中两个 bw 导入，看是否都挂出来
const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'http://127.0.0.1:8799/?db=hg38&locus=chr1:55,000,000-62,000,000';
(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('DOM.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false });
  const ev = async (e) => {
    const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const dump = async (tag) => console.log(tag, JSON.stringify(await ev(`(() => {
    const S = window.__igv.S;
    return { on: Object.fromEntries(S.bw.list.map(t => [t.id, !!S.bw.on[t.id]])),
      rows: [...document.querySelectorAll('#view .track[data-bw]')].map(el => {
        const c = el.querySelector('canvas');
        return el.dataset.bw + (el.hidden ? '[hidden]' : '[shown]') + ' h=' + (c ? c.style.height : '-');
      }),
      tops: [...document.querySelectorAll('#view .track[data-bw]')].filter(e=>!e.hidden).map(e => Math.round(e.getBoundingClientRect().top)) };
  })()`)));
  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(3000);
  await dump('初始:');
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const node = await cdp.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#fileInput' });
  await cdp.send('DOM.setFileInputFiles', {
    files: ['C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.4/tools/_up_eps.bw'],
    nodeId: node.result.nodeId });
  await sleep(9000);
  await dump('先导入 eps:');
  // 手动关掉 eps，然后再导入第二个文件，确认它不会被重新打开
  await ev(`(() => { const r=[...document.querySelectorAll('.bw-trk')].find(x=>x.dataset.bwid==='up_eps'); r.querySelector('input.on').click(); })()`);
  await sleep(1200);
  await dump('手动关掉 eps:');
  const doc2 = await cdp.send('DOM.getDocument', { depth: -1 });
  const node2 = await cdp.send('DOM.querySelector', { nodeId: doc2.result.root.nodeId, selector: '#fileInput' });
  await cdp.send('DOM.setFileInputFiles', {
    files: ['C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.4/tools/_up_zeta.bw'],
    nodeId: node2.result.nodeId });
  await sleep(9000);
  await dump('再导入 zeta:');
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
