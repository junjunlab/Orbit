// 样本名列开关：侧栏 Aa 按钮 + 轨道设置里的复选框
const fs = require('fs');
const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'http://127.0.0.1:8799/?db=hg38&locus=chr1:55,000,000-62,000,000';
const OUT = 'C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.4/tools/';
(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false });
  const ev = async (e) => {
    const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async (n) => {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + n, Buffer.from(s.result.data, 'base64'));
  };
  const st = () => ev(`(() => {
    const el = document.querySelector('.track[data-bw="TCGA-LUAD-10samples.seg"]');
    if (!el) return 'no track';
    const box = el.querySelector('.seg-sample-labels');
    const tg = [...document.querySelectorAll('.bw-trk .seg-nm-tg')];
    return { nonames: el.classList.contains('seg-nonames'),
      namesVisible: box ? box.getBoundingClientRect().width > 0 : null,
      nameRows: el.querySelectorAll('.seg-sample-name').length,
      cols: getComputedStyle(el).gridTemplateColumns,
      aaOn: tg.length ? tg[0].classList.contains('on') : null,
      canvasW: el.querySelector('canvas').getBoundingClientRect().width };
  })()`);
  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(5000);
  console.log('默认:', JSON.stringify(await st()));
  await shot('_seg_names_on.png');
  // 点侧栏 Aa 关掉
  await ev(`(() => { const b=document.querySelector('.bw-trk .seg-nm-tg'); b.click(); })()`);
  await sleep(1500);
  console.log('关掉后:', JSON.stringify(await st()));
  await shot('_seg_names_off.png');
  // 再从轨道设置浮层打开
  await ev(`document.querySelector('.track[data-bw="TCGA-LUAD-10samples.seg"] .tgear').click()`);
  await sleep(800);
  console.log('浮层:', await ev(`(() => { const r=[...document.querySelectorAll('.tpop .row')].find(x=>x.textContent.includes('样本名列')); return r ? r.textContent + ' | checked=' + r.querySelector('input').checked : 'no row'; })()`));
  await ev(`(() => { const r=[...document.querySelectorAll('.tpop .row')].find(x=>x.textContent.includes('样本名列')); r.querySelector('input').click(); })()`);
  await sleep(1500);
  console.log('浮层打开后:', JSON.stringify(await st()));
  await ev(`document.querySelector('#tpop .foot .btn.pri').click()`);
  await sleep(600);
  await shot('_seg_names_again.png');
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
