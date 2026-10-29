// CDP test: 每次启动都从「第一次打开软件」的状态开始 —— 上次留下的偏好整份作废。
// 做法：先手工往 localStorage 塞一份「上次的偏好」，再刷新，验证全部被忽略。
// 前置：开发服务器 8799（在 igv_0.2 下起）、无头 Chrome 9222（cdp.js 会自动拉起）。
const path = require('path');
const { connect } = require('./cdp');

const PORT = process.env.IGV_TEST_PORT || '8799';
const URL = `http://127.0.0.1:${PORT}/?db=hg38&locus=chr8:127735000-127743000`;
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
  const state = () => ev(`JSON.stringify({
    labelW: window.__igv.S.labelW,
    cssLabelW: getComputedStyle(document.querySelector('#view')).getPropertyValue('--label-w').trim(),
    order: [...document.querySelectorAll('#view .track')].map((e) => e.dataset.tkey).filter(Boolean),
    tint: window.__igv.S.tint,
    bwCfgKeys: Object.keys(window.__igv.S.bw.cfg || {}),
    expanded: [...window.__igv.S.expanded],
    prefsRaw: localStorage.getItem('igvlocal.prefs.v1'),
    splitRaw: sessionStorage.getItem('igvlocal.split.v1'),
    panels: window.__igv.S.panels.length,
    expLabels: window.__igv.S.expLabels
  })`);

  await send('Page.enable');
  await send('Runtime.enable');

  // 1) 第一次打开：干净状态
  await send('Page.navigate', { url: URL });
  await sleep(600);
  await ev('localStorage.clear(); sessionStorage.clear();');
  await send('Page.navigate', { url: URL });
  if (!await waitBoot()) { console.error('boot timeout'); await cdp.close(); process.exit(1); }
  await sleep(1200);
  const first = JSON.parse(await state());
  console.log('第一次打开 :', JSON.stringify({ labelW: first.labelW, panels: first.panels, prefs: first.prefsRaw }));

  // 2) 伪造「上次的偏好」：列宽 240、顺序倒置、基因配色、隐藏轨道、展开记录
  const fake = {
    bwCfg: { 'demo.bw': { color: '#ff0000', group: 'g1' } },
    bwGroups: [{ id: 'g1', name: 'G1', shared: true }],
    tint: { genesPlus: '#123456' },
    loadedTint: {},
    expanded: ['MYC|chr8'],
    loadedExpanded: [],
    bwHidden: ['demo.bw'],
    labelW: 240,
    trackOrder: ['s:overview', 's:seq', 's:gc', 's:genes', 's:ruler', 's:panehead', 's:ideogram'],
  };
  await ev(`localStorage.setItem('igvlocal.prefs.v1', ${JSON.stringify(JSON.stringify(fake))});
            localStorage.setItem('igvlocal.expLabels', '0');
            sessionStorage.setItem('igvlocal.split.v1', JSON.stringify({count:2, loci:[{chrom:'chr1',start:1,end:2},{chrom:'chr2',start:1,end:2}]}));`);

  // 3) 重启（等同关掉再打开）：上面那份必须全部作废
  await send('Page.navigate', { url: URL });
  if (!await waitBoot()) { console.error('reboot timeout'); await cdp.close(); process.exit(1); }
  await sleep(1500);
  const after = JSON.parse(await state());
  console.log('重启之后   :', JSON.stringify({ labelW: after.labelW, cssLabelW: after.cssLabelW,
    panels: after.panels, prefs: after.prefsRaw, split: after.splitRaw,
    tint: after.tint, bwCfg: after.bwCfgKeys, expanded: after.expanded, expLabels: after.expLabels }));
  console.log('重启后顺序 :', after.order.join(' | '));

  // 注意：boot 里清空后，本次会话会立刻把「默认值」重新写回去，
  // 所以这里不能断言 key 不存在，要断言写回去的内容就是默认值。
  const p = after.prefsRaw ? JSON.parse(after.prefsRaw) : {};
  const sp = after.splitRaw ? JSON.parse(after.splitRaw) : {};
  const tintAllNull = !p.tint || Object.values(p.tint).every((v) => v === null);
  const checks = {
    labelWReset: after.labelW === 116 && after.cssLabelW === '116px',
    orderReset: after.order.join() === first.order.join(),
    tintReset: !after.tint.genesPlus && tintAllNull,
    cfgReset: after.bwCfgKeys.length === 0 && Object.keys(p.bwCfg || {}).length === 0,
    expandedReset: after.expanded.length === 0 && (p.expanded || []).length === 0,
    hiddenReset: (p.bwHidden || []).length === 0,
    prefsAreDefaults: p.labelW === 116 && (p.bwGroups || []).length === 0
      && (p.trackOrder || []).join() === first.order.join(),
    splitIsSingle: (Number(sp.count) || 1) === 1,
    singlePanel: after.panels === 1,
    expLabelsReset: after.expLabels === true,
  };
  console.log('\nCHECKS:', JSON.stringify(checks));
  const ok = Object.values(checks).every(Boolean);
  console.log('RESULT:', ok ? 'PASS' : 'FAIL');
  await cdp.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
