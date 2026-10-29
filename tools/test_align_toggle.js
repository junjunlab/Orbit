// CDP test: BAM 比对视图的交互 —— 左侧「比对」勾选框开关、深色主题下的绘制。
// 前置：开发服务器 8799（IGV_RESTORE_LOADED=1）+ 无头 Chrome 9222。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.env.IGV_TEST_PORT || '8799';
const URL = `http://127.0.0.1:${PORT}/?db=hg38&locus=chr1:7670000-7680000`;
const TID = 'chr1_output';

async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const t = list.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const w = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params) => new Promise((res) => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) { console.error('JS ERR', JSON.stringify(r.result.exceptionDetails).slice(0, 500)); return null; }
    return r.result.result.value;
  };
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 120; i++) {
    const ok = await ev(`(() => { const S = window.__igv && window.__igv.S; const d = S && S.panels[S.act].alignData && S.panels[S.act].alignData[${JSON.stringify(TID)}]; return !!(d && d.reads); })()`);
    if (ok) break;
    await sleep(250);
  }

  // 1) 关掉「比对」勾选 -> 轨道隐藏
  const off = await ev(`(async () => {
    const row = document.querySelector('#bwList .align-trk[data-bwidalign="${TID}"]');
    if (!row) return 'row-missing';
    const cb = row.querySelector('input.on');
    cb.click();
    await new Promise(r => setTimeout(r, 500));
    const el = document.querySelector('.track[data-align="${TID}"]');
    return JSON.stringify({ hidden: el ? el.hidden : null, checked: cb.checked });
  })()`);
  console.log('ALIGN OFF', off);

  // 2) 再打开 -> 重新出现
  const on = await ev(`(async () => {
    const row = document.querySelector('#bwList .align-trk[data-bwidalign="${TID}"]');
    const cb = row.querySelector('input.on');
    cb.click();
    await new Promise(r => setTimeout(r, 900));
    const el = document.querySelector('.track[data-align="${TID}"]');
    const cv = el && el.querySelector('canvas');
    return JSON.stringify({ hidden: el ? el.hidden : null, checked: cb.checked, canvasH: cv ? cv.height : 0 });
  })()`);
  console.log('ALIGN ON', on);

  // 3) 深色主题下仍然能画出来
  const dark = await ev(`(async () => {
    document.querySelector('#btnTheme').click();
    await new Promise(r => setTimeout(r, 900));
    const el = document.querySelector('.track[data-align="${TID}"]');
    const cv = el && el.querySelector('canvas');
    let ink = 0;
    if (cv) {
      const img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < img.length; i += 4) if (img[i] > 60 && img[i] < 160) ink++;
    }
    const theme = document.body.dataset.theme;
    document.querySelector('#btnTheme').click();  // 切回浅色
    await new Promise(r => setTimeout(r, 400));
    return JSON.stringify({ theme, ink });
  })()`);
  console.log('DARK', dark);

  const fs = require('fs');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('tools/_align_toggle.png', Buffer.from(shot.result.data, 'base64'));

  let pass = false;
  try {
    const o = JSON.parse(off), n = JSON.parse(on), d = JSON.parse(dark);
    pass = o.hidden === true && o.checked === false
      && n.hidden === false && n.checked === true && n.canvasH > 20
      && d.theme === 'dark' && d.ink > 200;
  } catch { pass = false; }
  console.log(pass ? 'RESULT PASS' : 'RESULT FAIL');
  ws.close();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
