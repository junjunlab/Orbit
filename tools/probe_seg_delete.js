// 复现「导入的 SEG 轨道删除不了」：走一遍齿轮 → 删除该轨道 → 确认
const fs = require('fs');
const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'http://127.0.0.1:8799/?db=hg38&locus=chr1:55,000,000-62,000,000';

(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 400) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  // cdp.js 不转发事件，直接盖掉 confirm（否则 headless 会被弹窗卡住）
  const dialogs = [];

  await cdp.send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 120 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(2000);
  await ev(`(() => { window.confirm = (m) => { window.__lastConfirm = m; return true; }; })()`);

  const before = await ev(`JSON.stringify((window.__igv.S.bw.list||[]).map(t=>({id:t.id,loaded:!!t.loaded,fmt:t.format})))`);
  console.log('bw list before:', before);

  // 找 SEG 那一行的齿轮并点开
  const opened = await ev(`(() => {
    const t = (window.__igv.S.bw.list||[]).filter(x=>x.format==='seg').pop();
    if (!t) return 'no seg track';
    const row = document.querySelector('.track[data-bw="' + CSS.escape(t.id) + '"]');
    const gear = row && row.querySelector('.tgear');
    if (!gear) return 'no gear';
    gear.click();
    return t.id;
  })()`);
  console.log('gear on:', opened);
  await sleep(600);
  console.log('popup title:', await ev(`(document.querySelector('#tpop')||{}).textContent`).then?.() ?? await ev(`document.querySelector('#tpop').textContent.slice(0,80)`));

  const clicked = await ev(`(() => {
    const pop = document.querySelector('#tpop');
    const b = [...pop.querySelectorAll('button')].find(x => x.textContent.includes('删除该轨道'));
    if (!b) return 'no delete button: ' + [...pop.querySelectorAll('button')].map(x=>x.textContent).join('|');
    b.click();
    return 'clicked';
  })()`);
  console.log('delete button:', clicked);
  await sleep(2500);

  console.log('confirm text:', await ev(`window.__lastConfirm`));
  console.log('bw list after:', await ev(`JSON.stringify((window.__igv.S.bw.list||[]).map(t=>t.id))`));
  console.log('track rows after:', await ev(`JSON.stringify([...document.querySelectorAll('#view .track[data-bw]')].map(e=>e.dataset.bw))`));
  console.log('toast:', await ev(`document.querySelector('#toast').textContent`));
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.4/tools/_del_probe.png', Buffer.from(shot.result.data, 'base64'));
  await cdp.close();
})();
