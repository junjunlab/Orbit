// Verify the expanded state survives a page reload (localStorage).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = `http://localhost:${process.env.IGV_TEST_PORT || 8799}/?db=hg38&locus=chr8:127735000-127743000`;
async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const t = list.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const w = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params) => new Promise((res) => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) { console.error('ERR', JSON.stringify(r.result.exceptionDetails).slice(0,400)); return null; } return r.result.result.value; };
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 80; i++) { const v = await ev('!!(window.__igv && window.__igv.S && window.__igv.S.data.genes && window.__igv.S.data.genes.length)'); if (v) break; await sleep(250); }
  // clean slate, then expand MYC
  const r1 = await ev(`(async () => {
    const I = window.__igv;
    I.S.expanded.clear(); I.savePrefs ? I.savePrefs() : null;
    const g = I.S.data.genes.find(x => x.name === 'MYC');
    I.toggleExpand(g);
    await new Promise(r => setTimeout(r, 200));
    return JSON.stringify({ expanded: I.isExpanded(g), stored: JSON.parse(localStorage.getItem('igvlocal.prefs.v1')||'{}').expanded });
  })()`);
  console.log('BEFORE RELOAD', r1);
  // reload
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 80; i++) { const v = await ev('!!(window.__igv && window.__igv.S && window.__igv.S.data.genes && window.__igv.S.data.genes.length)'); if (v) break; await sleep(250); }
  await sleep(400);
  const r2 = await ev(`(() => {
    const I = window.__igv;
    const g = I.S.data.genes.find(x => x.name === 'MYC');
    const L = I.geneLayout();
    const p = L.placed.find(pp => pp.g === g);
    return JSON.stringify({ expanded: I.isExpanded(g), span: p ? p.span : null, rows: L.maxRows });
  })()`);
  console.log('AFTER RELOAD ', r2);
  // cleanup: collapse again
  await ev(`(() => { const I=window.__igv; const g=I.S.data.genes.find(x=>x.name==='MYC'); I.toggleExpand(g); return 1; })()`);
  const ok = JSON.parse(r1).expanded && JSON.parse(r2).expanded && JSON.parse(r2).span === 2;
  console.log(ok ? 'RESULT PASS' : 'RESULT FAIL');
  ws.close();
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error(e.message); process.exit(1); });
