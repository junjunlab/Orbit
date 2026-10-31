const fs = require('fs');
const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'http://127.0.0.1:8799/?db=hg38&locus=chr1:55,000,000-62,000,000';
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
  await ev(`document.querySelector('.track[data-bw="TCGA-LUAD-10samples.seg"] .tgear').click()`);
  await sleep(900);
  console.log('浮层行:', JSON.stringify(await ev(`[...document.querySelectorAll('.tpop .row')].map(r => r.textContent.trim().slice(0, 24))`)));
  console.log('零值颜色输入:', await ev(`(() => { const r=[...document.querySelectorAll('.tpop .row')].find(x=>x.textContent.includes('Zero')||x.textContent.includes('零值')); const c=r&&r.querySelector('input[type=color]'); return c ? c.value : 'none'; })()`));
  // 把零值颜色改成纯白，看热图是否立刻变（中性格变白）
  await ev(`(() => { const S=window.__igv.S, t=(S.bw.list||[]).find(x=>x.heatmap); S.bw.cfg[t.id]=Object.assign({},S.bw.cfg[t.id],{heatMid:'#ffffff'}); window.__igv.render(); })()`);
  await sleep(1200);
  const s1 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '_seg_mid_white.png', Buffer.from(s1.result.data, 'base64'));
  await ev(`(() => { const S=window.__igv.S, t=(S.bw.list||[]).find(x=>x.heatmap); S.bw.cfg[t.id]=Object.assign({},S.bw.cfg[t.id],{heatMid:'#ffe08a'}); window.__igv.render(); })()`);
  await sleep(1200);
  const s2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '_seg_mid_gold.png', Buffer.from(s2.result.data, 'base64'));
  await ev(`(() => { const S=window.__igv.S, t=(S.bw.list||[]).find(x=>x.heatmap); S.bw.cfg[t.id]=Object.assign({},S.bw.cfg[t.id],{heatMid:''}); window.__igv.render(); })()`);
  console.log('ok');
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
