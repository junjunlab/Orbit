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
  const shot = async (n) => {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + n, Buffer.from(s.result.data, 'base64'));
  };
  const st = () => ev(`(() => {
    const el = document.querySelector('.track[data-bw="TCGA-LUAD-10samples.seg"]');
    const btns = [...document.querySelectorAll('.bw-trk .seg-nm-tg')].map(b => b.textContent + (b.classList.contains('on') ? '(on)' : '(off)'));
    return { h: el.querySelector('canvas').style.height,
      sumLabel: !!el.querySelector('.seg-summary-name'), btns };
  })()`);
  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 150 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(6000);
  console.log('默认:', JSON.stringify(await st()));
  await ev(`(() => { const b=[...document.querySelectorAll('.bw-trk .seg-nm-tg')].find(x=>x.textContent==='Σ'); b.click(); })()`);
  await sleep(1500);
  console.log('关掉汇总:', JSON.stringify(await st()));
  await shot('_seg_sum_off.png');
  await ev(`(() => { const b=[...document.querySelectorAll('.bw-trk .seg-nm-tg')].find(x=>x.textContent==='Σ'); b.click(); })()`);
  await sleep(1500);
  console.log('再打开:', JSON.stringify(await st()));
  await shot('_seg_sum_on.png');
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
