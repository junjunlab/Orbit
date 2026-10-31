// 三种 SEG 热图布局各截一张：样本为行 / 样本为列 / 紧凑
const fs = require('fs');
const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'http://127.0.0.1:8799/?db=hg38&locus=chr1:55,000,000-62,000,000';
const OUT = 'C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.4/tools/';

(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false });
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 400) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async (name) => {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + name, Buffer.from(s.result.data, 'base64'));
  };

  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(2500);

  // 打开 SEG 热图轨道
  const tid = await ev(`(() => {
    const S = window.__igv.S;
    const t = (S.bw.list || []).filter(x => x.heatmap).pop();
    if (!t) return null;
    S.bw.on[t.id] = true;
    window.__igv.loadBwTracks ? null : null;
    return t.id;
  })()`);
  console.log('seg track:', tid);
  await ev(`window.__igv.setBwOn ? window.__igv.setBwOn('${tid}', true) : null`);
  await ev(`(() => { const S = window.__igv.S; S.bw.on['${tid}'] = true; })()`);
  await ev(`window.__igv.loadBwTracks && window.__igv.loadBwTracks()`);
  await sleep(1200);
  await ev(`(() => { const S = window.__igv.S; S.bw.on['${tid}'] = true; window.__igv.render(); })()`);
  await sleep(2500);
  console.log('rows:', await ev(`(() => { const d = window.__igv.S.bw.data['${tid}']; return d && d.rows ? d.rows.length : null; })()`));

  // 1) 样本为行
  await ev(`(() => { const S = window.__igv.S; S.bw.cfg['${tid}'] = Object.assign({}, S.bw.cfg['${tid}'], { segLayout: 'row' }); window.__igv.render(); })()`);
  await sleep(1500);
  console.log('row h:', await ev(`document.querySelector('.track[data-bw="${tid}"] canvas').style.height`));
  await shot('_seg_row.png');

  // 2) 样本为列
  await ev(`(() => { const S = window.__igv.S; S.bw.cfg['${tid}'] = Object.assign({}, S.bw.cfg['${tid}'], { segLayout: 'col' }); window.__igv.render(); })()`);
  await sleep(1500);
  console.log('col h:', await ev(`document.querySelector('.track[data-bw="${tid}"] canvas').style.height`));
  await shot('_seg_col.png');

  // 3) 紧凑
  await ev(`(() => { const S = window.__igv.S; S.bw.cfg['${tid}'] = Object.assign({}, S.bw.cfg['${tid}'], { segLayout: 'none' }); window.__igv.render(); })()`);
  await sleep(1200);
  await shot('_seg_none.png');

  // 4) 设置浮层（布局三个按钮）
  await ev(`(() => { const S = window.__igv.S; S.bw.cfg['${tid}'] = Object.assign({}, S.bw.cfg['${tid}'], { segLayout: 'row' }); window.__igv.render(); })()`);
  await sleep(600);
  await ev(`(() => { const row = document.querySelector('.track[data-bw="${tid}"]'); row.querySelector('.tgear').click(); })()`);
  await sleep(700);
  console.log('popup:', await ev(`document.querySelector('#tpop').textContent.slice(0, 120)`));
  await shot('_seg_pop2.png');

  await cdp.close();
})();
