// CDP test: batch-delete imported (loaded) tracks from the 已导入 list.
// Safe: only deletes the two temp tracks uploaded by the caller (_bwdel_testA/B).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.env.IGV_TEST_PORT || 8799;
const URL = `http://localhost:${PORT}/?db=hg38&locus=chr1:1-5000`;
const IDS = ['bwdel_testA', 'bwdel_testB'];

async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const t = list.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const w = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params) => new Promise((res) => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) { console.error('JS ERR', JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return null; }
    return r.result.result.value;
  };

  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 80; i++) {
    const v = await ev(`!!(window.__igv && window.__igv.S && window.__igv.S.loaded && window.__igv.S.loaded.list)`);
    if (v) break; await sleep(250);
  }
  // wait until both temp tracks are in the loaded list
  let ready = false;
  for (let i = 0; i < 40; i++) {
    ready = await ev(`(() => { const L = window.__igv.S.loaded.list.map(t=>t.id); return ${JSON.stringify(IDS)}.every(x=>L.includes(x)); })()`);
    if (ready) break; await sleep(250);
  }
  const initial = await ev(`JSON.stringify({ ids: window.__igv.S.loaded.list.map(t=>t.id), rows: document.querySelectorAll('#loadedList .loaded-trk').length })`);
  console.log('INITIAL', initial);
  if (!ready) { console.log('RESULT FAIL (temp tracks not loaded)'); ws.close(); process.exit(1); }

  // 1) real click to select first, ctrl+click for second
  const selRes = await ev(`(() => {
    const rows = [...document.querySelectorAll('#loadedList .loaded-trk')];
    const byId = {};
    for (const r of rows) byId[r.dataset.loadedid] = r;
    const a = byId['bwdel_testA'], b = byId['bwdel_testB'];
    if (!a || !b) return 'rows-missing';
    a.querySelector('.nm').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    b.querySelector('.nm').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    const sel = [...window.__igv.S.loaded.sel];
    const selRows = [...document.querySelectorAll('#loadedList .loaded-trk.sel')].map(r=>r.dataset.loadedid);
    return JSON.stringify({ sel, selRows });
  })()`);
  console.log('SELECT', selRes);

  // 2) right-click on one of the selected rows -> context menu
  const menuRes = await ev(`(() => {
    const row = document.querySelector('#loadedList .loaded-trk[data-loadedid="bwdel_testB"]');
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 8 }));
    const menu = document.querySelector('#loadedCtx');
    const items = [...menu.querySelectorAll('.ctx-item')].map(b => b.textContent);
    const danger = menu.querySelector('.ctx-item.danger');
    return JSON.stringify({ visible: !menu.hidden, head: menu.querySelector('.ctx-head')?.textContent, items, danger: danger?.textContent || null });
  })()`);
  console.log('MENU', menuRes);

  // 3) confirm() -> true, click delete, wait for reload
  const delRes = await ev(`(async () => {
    window.confirm = () => true;
    const menu = document.querySelector('#loadedCtx');
    const danger = menu.querySelector('.ctx-item.danger');
    if (!danger) return 'no-danger';
    danger.click();
    await new Promise(r => setTimeout(r, 1200));
    const ids = window.__igv.S.loaded.list.map(t=>t.id);
    const rows = document.querySelectorAll('#loadedList .loaded-trk').length;
    const gone = !ids.includes('bwdel_testA') && !ids.includes('bwdel_testB');
    const menuHidden = document.querySelector('#loadedCtx').hidden;
    return JSON.stringify({ ids, rows, gone, menuHidden });
  })()`);
  console.log('AFTER DELETE', delRes);

  // 4) server-side check
  const srv = await ev(`fetch('api/loaded').then(r=>r.json()).then(d=>JSON.stringify(d.tracks.map(t=>t.id)))`);
  console.log('SERVER LOADED', srv);

  let pass = false;
  try {
    const d = JSON.parse(delRes);
    const s = JSON.parse(srv);
    pass = d.gone && d.rows === 0 && d.menuHidden && !s.includes('bwdel_testA') && !s.includes('bwdel_testB');
  } catch { pass = false; }
  console.log(pass ? 'RESULT PASS' : 'RESULT FAIL');

  // safety cleanup if anything remains
  await ev(`Promise.all(${JSON.stringify(IDS)}.map(id=>fetch('api/loaded?id='+encodeURIComponent(id),{method:'DELETE'}).catch(()=>{})))`);
  ws.close();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
