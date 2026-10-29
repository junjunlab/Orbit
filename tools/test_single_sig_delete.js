// CDP test: single signal track right-click -> settings popup has "删除该轨道" -> delete works.
// Safe: only touches the temp track uploaded by the caller (_sigdel_test).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'http://localhost:8799/?db=hg38&locus=chr1:1-5000';
const ID = 'sigdel_test';
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
    if (r.result && r.result.exceptionDetails) { console.error('JS ERR', JSON.stringify(r.result.exceptionDetails).slice(0, 500)); return null; }
    return r.result.result.value;
  };
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 80; i++) {
    const v = await ev(`!!(window.__igv && window.__igv.S.bw.list.some(t=>t.id===${JSON.stringify(ID)}))`);
    if (v) break; await sleep(250);
  }
  // right-click the single track (not selected yet) -> settings popup
  const pop = await ev(`(() => {
    const row = document.querySelector('.bw-trk[data-bwid="${ID}"]');
    if (!row) return 'row-missing';
    const rc = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rc.left + 20, clientY: rc.top + 8 }));
    const tp = document.querySelector('#tpop');
    const danger = tp.querySelector('.btn.danger');
    return JSON.stringify({ popVisible: !tp.hidden, title: tp.querySelector('h5')?.textContent, danger: danger?.textContent || null });
  })()`);
  console.log('POPUP', pop);

  const del = await ev(`(async () => {
    window.confirm = () => true;
    const btn = document.querySelector('#tpop .btn.danger');
    if (!btn) return 'no-danger-btn';
    btn.click();
    await new Promise(r => setTimeout(r, 1600));
    return JSON.stringify({
      inList: window.__igv.S.bw.list.some(t=>t.id==='${ID}'),
      popHidden: document.querySelector('#tpop').hidden,
    });
  })()`);
  console.log('AFTER DELETE', del);

  const srv = await ev(`fetch('api/bwtracks').then(r=>r.json()).then(d=>JSON.stringify(d.tracks.map(t=>t.id)))`);
  console.log('SERVER BW', srv);

  let pass = false;
  try {
    const p = JSON.parse(pop), d = JSON.parse(del), s = JSON.parse(srv);
    pass = p.popVisible && p.danger === '删除该轨道' && !d.inList && d.popHidden && !s.includes(ID);
  } catch { pass = false; }
  console.log(pass ? 'RESULT PASS' : 'RESULT FAIL');
  await ev(`fetch('api/loaded?id=${ID}',{method:'DELETE'}).catch(()=>{})`);
  ws.close();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
