// 模拟用户真实导入：先把 trackA 勾上，再通过文件选择框导入 trackC.bw
const fs = require('fs');
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
      rows: [...document.querySelectorAll('#view .track[data-bw]')].map(el => el.dataset.bw + (el.hidden ? '[hidden]' : '[shown]')) };
  })()`)));
  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(3000);
  await dump('初始:');

  // 把侧栏 trackA 的勾选框点开（模拟用户手动打开）
  await ev(`(() => { const r=[...document.querySelectorAll('.bw-trk')].find(x=>x.dataset.bwid==='trackA'); r.querySelector('input.on').click(); })()`);
  await sleep(2500);
  await dump('勾上 A 后:');

  // 通过真实文件选择框导入第三个 bw
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const node = await cdp.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#fileInput' });
  await cdp.send('DOM.setFileInputFiles', { files: ['C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.4/tools/_up_trackC.bw'], nodeId: node.result.nodeId });
  await sleep(6000);
  await dump('导入 C 后:');
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
