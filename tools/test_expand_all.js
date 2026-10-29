// CDP test: RefSeq / 导入 GTF 轨道设置里的「全部展开 / 全部收起」。
// 前置：开发服务器 8799（在 igv_0.2 下起）、无头 Chrome 9222（cdp.js 会自动拉起）。
const fs = require('fs');
const path = require('path');
const { connect } = require('./cdp');

const PORT = process.env.IGV_TEST_PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const LOCUS = 'chr17:7500000-7760000';          // 基因密集，83 个基因
const URL = `${BASE}/?db=hg38&locus=${LOCUS}`;
const OUT_ON = path.join(__dirname, '_expand_all_on.png');
const OUT_OFF = path.join(__dirname, '_expand_all_off.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cdp = await connect();
  const { send } = cdp;
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      console.error('JS ERR', JSON.stringify(r.result.exceptionDetails).slice(0, 500));
      return null;
    }
    return r.result.result.value;
  };
  const waitBoot = async () => {
    for (let i = 0; i < 160; i++) {
      if (await ev('!!(window.__igv && window.__igv.S.asm)')) return true;
      await sleep(250);
    }
    return false;
  };
  // 当前窗口里「多转录本基因」的展开情况 + 轨道高度
  const stat = () => ev(`(() => {
    const L = window.__igv.geneLayout();
    const multi = L.placed.filter((p) => (p.txl || []).length > 1);
    const el = document.querySelector('.track[data-track="genes"]');
    const cv = el && (el.querySelector('.pane[data-p="0"] canvas') || el.querySelector('.track-body > canvas'));
    return JSON.stringify({
      expandAll: window.__igv.S.expandAll,
      count: L.count, maxRows: L.maxRows, multi: multi.length,
      expandedMulti: multi.filter((p) => p.expanded).length,
      trackH: el ? Math.round(el.getBoundingClientRect().height) : 0,
      canvasH: cv ? Math.round(cv.getBoundingClientRect().height) : 0
    });
  })()`);
  const openGear = (sel) => ev(`(() => {
    const g = document.querySelector(${JSON.stringify(sel)});
    if (!g) return false;
    g.click();
    return true;
  })()`);
  // 点弹窗里文字为 text 的按钮
  const clickPopBtn = (text) => ev(`(() => {
    const pop = document.querySelector('#tpop');
    if (!pop || pop.hidden) return 'no-popup';
    const b = [...pop.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
    if (!b) return 'no-button';
    b.click();
    return 'ok';
  })()`);
  const popInfo = () => ev(`(() => {
    const pop = document.querySelector('#tpop');
    if (!pop || pop.hidden) return JSON.stringify({ open: false });
    return JSON.stringify({
      open: true,
      title: (pop.querySelector('h5') || {}).textContent || '',
      labels: [...pop.querySelectorAll('.row > .lbl')].map((x) => x.textContent),
      buttons: [...pop.querySelectorAll('button')].map((x) => x.textContent.trim()),
      hint: (pop.querySelector('.hint') || {}).textContent || ''
    });
  })()`);
  const shot = async (f) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(f, Buffer.from(s.result.data, 'base64'));
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(600);
  await ev('localStorage.clear(); sessionStorage.clear();');
  await send('Page.navigate', { url: URL });
  if (!await waitBoot()) { console.error('boot timeout'); await cdp.close(); process.exit(1); }
  await sleep(1800);

  const before = JSON.parse(await stat());
  console.log('展开前 :', JSON.stringify(before));
  await shot(OUT_OFF);

  // 1) 打开 RefSeq 的齿轮
  await openGear('.tgear[data-gear="genes"]');
  await sleep(350);
  const pop = JSON.parse(await popInfo());
  console.log('弹窗   :', JSON.stringify(pop));

  // 2) 点「全部展开」
  const r1 = await clickPopBtn('全部展开');
  await sleep(1200);
  const on = JSON.parse(await stat());
  console.log('展开后 :', JSON.stringify(on));
  const popOn = JSON.parse(await popInfo());
  await shot(OUT_ON);

  // 3) 平移之后新出现的基因也应该保持展开
  await ev(`window.__igv.navigate('chr17', 7800000, 8060000)`);
  await sleep(1400);
  const moved = JSON.parse(await stat());
  console.log('平移后 :', JSON.stringify(moved));

  // 4) 回到原位，点「全部收起」
  await ev(`window.__igv.navigate('chr17', 7500000, 7760000)`);
  await sleep(1200);
  await openGear('.tgear[data-gear="genes"]');
  await sleep(300);
  const r2 = await clickPopBtn('全部收起');
  await sleep(1000);
  const off = JSON.parse(await stat());
  console.log('收起后 :', JSON.stringify(off));

  // 5) 导入 GTF 轨道也要有同样的按钮，而且和 RefSeq 互不影响
  const listed = await (await fetch(`${BASE}/api/loaded`)).json();
  if (!(listed.tracks || []).some((t) => t.id === 'demo_genes')) {
    const buf = fs.readFileSync(path.join(__dirname, '..', 'data', 'samples', 'demo_genes.gtf'));
    await fetch(`${BASE}/api/load?name=demo_genes.gtf`, { method: 'POST', body: buf });
  }
  await send('Page.navigate', { url: `${URL}` });
  await waitBoot();
  await sleep(2000);
  await ev(`window.__igv.S.loaded.on['demo_genes'] = true; window.__igv.loadLoadedTracks();`);
  await sleep(1200);
  const hasLoadedGear = await openGear('.tgear[data-gear="lgenes"][data-bwid="demo_genes"]');
  await sleep(350);
  const lpop = JSON.parse(await popInfo());
  const lr = await clickPopBtn('全部展开');
  await sleep(600);
  const loadedOn = await ev(`window.__igv.S.loaded.expandAll.has('demo_genes')`);
  const refseqUnaffected = await ev(`window.__igv.S.expandAll`);

  const checks = {
    popupHasRow: pop.open && pop.labels.includes('转录本') && pop.buttons.includes('全部展开') && pop.buttons.includes('全部收起'),
    expandAllOn: on.expandAll === true && r1 === 'ok',
    allGenesExpanded: on.multi > 0 && on.expandedMulti === on.multi,
    trackGrew: on.trackH > before.trackH && on.canvasH > before.canvasH,
    hintReflectsState: /全部展开/.test(popOn.hint || ''),
    survivesNavigate: moved.expandAll === true && moved.multi > 0 && moved.expandedMulti === moved.multi,
    collapseWorks: off.expandAll === false && r2 === 'ok' && off.expandedMulti === 0
      && off.trackH === before.trackH,
    loadedHasRow: hasLoadedGear === true && lpop.labels.includes('转录本') && lr === 'ok',
    loadedExpandAll: loadedOn === true,
    refseqIndependent: refseqUnaffected === false,
  };
  console.log('\nCHECKS:', JSON.stringify(checks, null, 0));
  const ok = Object.values(checks).every(Boolean);
  console.log('RESULT:', ok ? 'PASS' : 'FAIL');
  await cdp.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
