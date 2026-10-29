// CDP test: 分屏布局只在该「刷新」时恢复，重新打开（普通导航）应回到单屏。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.env.IGV_TEST_PORT || '8799';
const URL = `http://127.0.0.1:${PORT}/?db=hg38&locus=chr1:1000000-1010000`;

async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const t = list.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const w = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (m, p) => new Promise((res) => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) { console.error('JS ERR', JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return null; }
    return r.result.result.value;
  };
  const waitBoot = async () => {
    for (let i = 0; i < 120; i++) {
      const ok = await ev(`!!(window.__igv && window.__igv.S.asm && window.__igv.S.panels.length)`);
      if (ok) return true;
      await sleep(250);
    }
    return false;
  };
  await send('Page.enable');
  await send('Runtime.enable');

  // 1) 首次打开：应单屏
  await send('Page.navigate', { url: URL });
  await waitBoot();
  await sleep(600);
  const first = await ev(`window.__igv.S.panels.length`);

  // 2) 手动分屏到 2（会写 sessionStorage）
  await ev(`window.__igv.setPanelCount(2)`);
  await sleep(900);
  const afterSplit = await ev(`window.__igv.S.panels.length`);

  // 3) 刷新（reload）→ 应恢复 2
  await send('Page.reload', { ignoreCache: true });
  await waitBoot();
  await sleep(800);
  const afterReload = await ev(`window.__igv.S.panels.length`);

  // 4) 模拟「重新打开程序」：普通导航到同一个 URL → 应回到 1
  await send('Page.navigate', { url: URL });
  await waitBoot();
  await sleep(800);
  const afterReopen = await ev(`(() => ({
    panels: window.__igv.S.panels.length,
    nav: (performance.getEntriesByType('navigation')[0] || {}).type,
    splitStore: sessionStorage.getItem('igvlocal.split.v1'),
  }))()`);

  // 5) 显式 ?loci= 仍应分屏
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?db=hg38&loci=chr1:1000000-1010000,chr2:2000000-2010000` });
  await waitBoot();
  await sleep(900);
  const explicit = await ev(`window.__igv.S.panels.length`);

  console.log('first open panels =', first);
  console.log('after split      =', afterSplit);
  console.log('after reload     =', afterReload);
  console.log('after reopen     =', JSON.stringify(afterReopen));
  console.log('explicit ?loci=  =', explicit);

  const pass = first === 1 && afterSplit === 2 && afterReload === 1
    && afterReopen && afterReopen.panels === 1 && explicit === 2;
  console.log(pass ? 'RESULT PASS' : 'RESULT FAIL');
  ws.close();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
