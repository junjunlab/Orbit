// SEG 热图样本勾选：默认全选 / 取消两个 / 转置 / 全不选
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
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async (name) => {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + name, Buffer.from(s.result.data, 'base64'));
  };
  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(2500);

  const tid = await ev(`(() => { const t = (window.__igv.S.bw.list||[]).filter(x=>x.heatmap).pop(); return t ? t.id : null; })()`);
  await ev(`(() => { const S=window.__igv.S; S.bw.on['${tid}']=true; S.bw.cfg['${tid}']=Object.assign({}, S.bw.cfg['${tid}'], {segLayout:'row', segHide:[]}); window.__igv.loadBwTracks && window.__igv.loadBwTracks(); })()`);
  await sleep(2500);
  const H = () => ev(`document.querySelector('.track[data-bw="${tid}"] canvas').style.height`);
  const SUB = () => ev(`document.querySelector('.track[data-bw="${tid}"] .sub').textContent`);

  console.log('默认:', await H(), '|', await SUB(), '| checked:', await ev(`(() => { const r = document.querySelector('.track[data-bw="${tid}"] .tgear'); r.click(); return document.querySelectorAll('.tpop .smp input:checked').length + '/' + document.querySelectorAll('.tpop .smp input').length; })()`));
  await sleep(700);
  await shot('_seg_pick_pop.png');

  // 取消第 4、7 个样本（下标 3、6）
  await ev(`(() => { const cbs = document.querySelectorAll('.tpop .smp input'); cbs[3].click(); cbs[6].click(); })()`);
  await sleep(1200);
  console.log('取消 2 个:', await H(), '|', await SUB(), '|', await ev(`document.querySelector('.tpop .cnt').textContent`));
  await shot('_seg_pick_pop2.png');
  await ev(`document.querySelector('#tpop .foot .btn.pri').click()`);
  await sleep(900);
  await shot('_seg_pick_row.png');

  // 转置 + 同一批选择
  await ev(`(() => { const S=window.__igv.S; S.bw.cfg['${tid}']=Object.assign({}, S.bw.cfg['${tid}'],{segLayout:'col'}); window.__igv.render(); })()`);
  await sleep(1200);
  console.log('转置:', await H(), '|', await SUB());
  await shot('_seg_pick_col.png');

  // 全不选
  await ev(`(() => { const S=window.__igv.S; S.bw.cfg['${tid}']=Object.assign({}, S.bw.cfg['${tid}'],{segLayout:'row'}); window.__igv.render(); })()`);
  await sleep(800);
  await ev(`(() => { document.querySelector('.track[data-bw="${tid}"] .tgear').click(); })()`);
  await sleep(600);
  await ev(`(() => { const b=[...document.querySelectorAll('.tpop .smp-head .btn')].find(x=>x.textContent.includes('全不选')); b.click(); })()`);
  await sleep(1200);
  console.log('全不选:', await H(), '| sub="' + (await SUB()) + '"');
  await shot('_seg_pick_none.png');
  console.log('全不选后勾选数:', await ev(`document.querySelectorAll('.tpop .smp input:checked').length + '/' + document.querySelectorAll('.tpop .smp input').length + ' cnt=' + document.querySelector('.tpop .cnt').textContent`));
  await ev(`document.querySelector('#tpop .foot .btn.pri').click()`);
  await sleep(900);
  await shot('_seg_pick_none2.png');

  // 恢复全选
  await ev(`(() => { const b=[...document.querySelectorAll('.tpop .smp-head .btn')].find(x=>x.textContent.trim()==='全选'); if(b) b.click(); })()`);
  await sleep(1000);
  console.log('恢复全选:', await H(), '|', await SUB());
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
