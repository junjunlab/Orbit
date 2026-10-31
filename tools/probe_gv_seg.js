// 全基因组视野里的 SEG 热图
const fs = require('fs');
const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'http://127.0.0.1:8799/?db=hg38&locus=chr1:55,000,000-62,000,000';
const OUT = 'C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.4/tools/';
(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false });
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 400) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async (n) => {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + n, Buffer.from(s.result.data, 'base64'));
  };
  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(2500);
  const tid = await ev(`(() => { const t = (window.__igv.S.bw.list||[]).filter(x=>x.heatmap).pop(); return t ? t.id : null; })()`);
  await ev(`(() => { const S=window.__igv.S; S.bw.on['${tid}']=true; window.__igv.loadBwTracks && window.__igv.loadBwTracks(); })()`);
  await sleep(2500);
  await ev(`window.__igv.pickChrom('*')`);
  await sleep(4000);
  console.log('gv状态:', await ev(`(() => {
    const S=window.__igv.S, t=(S.bw.list||[]).filter(x=>x.heatmap).pop(), d=S.bw.data[t.id]||{};
    const el=document.querySelector('.track[data-bw="'+t.id+'"]');
    return { genomeView: S.genomeView, hidden: el && el.hidden, genome: !!d.genome,
      order: (d.order||[]).length, bins: d.bins, rows: (d.rows||[]).length,
      names: document.querySelectorAll('.track[data-bw="'+t.id+'"] .seg-sample-name').length,
      canvas: el && el.querySelector('canvas').style.height };
  })()`));
  await shot('_gv_seg.png');
  // 取消 2 个样本后
  await ev(`(() => { const S=window.__igv.S, t=(S.bw.list||[]).filter(x=>x.heatmap).pop(); S.bw.cfg[t.id]=Object.assign({},S.bw.cfg[t.id],{segHide:[3,6]}); window.__igv.render(); })()`);
  await sleep(1500);
  await shot('_gv_seg_pick.png');
  console.log('取消后:', await ev(`(() => { const S=window.__igv.S, t=(S.bw.list||[]).filter(x=>x.heatmap).pop(); return document.querySelectorAll('.track[data-bw="'+t.id+'"] .seg-sample-name').length + ' 名称行 / ' + document.querySelector('.track[data-bw="'+t.id+'"] .sub').textContent; })()`));
  await ev(`(() => { const S=window.__igv.S, t=(S.bw.list||[]).filter(x=>x.heatmap).pop(); S.bw.cfg[t.id]=Object.assign({},S.bw.cfg[t.id],{segHide:[]}); })()`);
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
