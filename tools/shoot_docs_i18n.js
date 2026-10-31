// 文档截图：按界面语言各出一套（docs/examples/en、docs/examples/zh）。
//
//   node tools/shoot_docs_i18n.js <port> <lang> <scene组>
//     port  已启动的会话端口（hg38 组或 custom 组）
//     lang  en | zh     —— 切换界面语言后重载页面
//     scope hg38 | custom
//
// 依赖服务端已经导入好数据（脚本不做上传，避免每个语言重复导入）。
const { open, goto, sleep, shot } = require('./doc_session');

const PORT = process.argv[2] || '8837';
const LANG = process.argv[3] || 'en';
const SCOPE = process.argv[4] || 'hg38';
const BASE = `http://127.0.0.1:${PORT}`;
const log = (...a) => console.log(`[${LANG}/${SCOPE}]`, ...a);

async function main() {
  const { cdp, ev } = await open({ width: 1440, height: 900 });
  const mouse = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent',
    { type, x, y, button: 'none', ...extra });
  const click = async (x, y) => {
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
    await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 });
    await sleep(400);
  };
  const rightClick = async (x, y) => {
    await mouse('mousePressed', x, y, { button: 'right', buttons: 2, clickCount: 1 });
    await mouse('mouseReleased', x, y, { button: 'right', buttons: 0, clickCount: 1 });
    await sleep(700);
  };
  const box = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return null; const r = e.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, top: r.top, bottom: r.bottom,
             left: r.left, right: r.right, w: r.width, h: r.height }; })()`);
  const rows = () => ev(`(() => { const rs = Array.from(document.querySelectorAll('#view .track')).filter(e => !e.hidden);
    if (!rs.length) return null;
    return { top: Math.round(Math.min(...rs.map(e => e.getBoundingClientRect().top))),
             bottom: Math.round(Math.max(...rs.map(e => e.getBoundingClientRect().bottom))) }; })()`);
  // shot() 已经按 docs/examples 拼路径，这里只给相对名
  const out = (name) => `${LANG}/${name}`;

  // 切语言：存 orbit.lang 后重载，页面里的中文/英文会被 i18n 整体替换
  await goto(ev, cdp, `${BASE}/`);
  await ev(`localStorage.setItem('orbit.lang', ${JSON.stringify(LANG)})`);
  await cdp.send('Page.reload', { ignoreCache: false });
  for (let i = 0; i < 150; i++) { if (await ev('!!window.__igv')) break; await sleep(200); }
  await sleep(1500);
  log('lang =', await ev(`document.documentElement.lang`));

  const enableAll = async (opts = {}) => ev(`(async () => { const S = window.__igv.S;
    for (const t of S.loaded.list) S.loaded.on[t.id] = ${opts.loaded !== false};
    for (const t of S.bw.list) S.bw.on[t.id] = ${opts.bw !== false};
    window.__igv.loadLoadedTracks(); window.__igv.loadBwTracks();
    if (${opts.labelW || 0}) window.__igv.applyLabelW(${opts.labelW || 0});
    S.tracks.genes = ${opts.genes !== false}; S.tracks.gc = false; S.tracks.seq = false;
    ${opts.extra || ''}
    window.__igv.ensureAll(true);
    await new Promise(r => setTimeout(r, 1000));
    await window.__igv.navigate(${JSON.stringify(opts.chrom || 'chr1')}, ${opts.start || 1}, ${opts.end || 60000000});
    await new Promise(r => setTimeout(r, 2200)); })()`);

  if (SCOPE === 'hg38') {
    /* ---------------------------------------------- BAM：三轨道 ------------------ */
    await ev(`window.__igv.applyLabelW(250)`);
    await enableAll({ chrom: 'chr1', start: 11792000, end: 11800000, bw: false, extra: `
      for (const t of S.bw.list) S.bw.on[t.id] = (t.id === 'SRR22507537.chr1');
      S.bw.on['SRR22507537.chr1::align'] = true;` });
    await sleep(1200);
    let b = await rows();
    await shot(cdp, out('bam-three-tracks.png'), { x: 0, y: 0, width: 1440, height: Math.min(880, b.bottom + 6) });
    log('bam-three-tracks ok');

    // Alignments 右键菜单
    const al = await box('.track[data-align="SRR22507537.chr1"] .track-label');
    if (al) {
      await rightClick(al.cx, al.cy);
      const pop = await box('#tpop');
      if (pop) {
        await shot(cdp, out('bam-align-menu.png'), {
          x: Math.max(0, Math.round(pop.left - 16)), y: Math.max(0, Math.round(pop.top - 12)),
          width: Math.round(pop.w + 32), height: Math.round(pop.h + 24) });
        log('bam-align-menu ok');
      }
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(400);
    }

    // Coverage 齿轮 → BAM 设置
    const gear = await box('.track[data-bw="SRR22507537.chr1"] .tgear');
    if (gear) {
      await click(gear.cx, gear.cy);
      const pop = await box('#tpop');
      if (pop) {
        await shot(cdp, out('bam-settings.png'), {
          x: Math.max(0, Math.round(pop.left - 16)), y: Math.max(0, Math.round(pop.top - 12)),
          width: Math.round(pop.w + 32), height: Math.round(pop.h + 24) });
        log('bam-settings ok');
      }
      await click(1180, 820);
      await sleep(400);
    }

    // 侧栏：两份 BAM 的子轨道
    await ev(`(async () => { const S = window.__igv.S;
      for (const t of S.bw.list) { S.bw.on[t.id] = true; S.bw.on[t.id + '::align'] = true; }
      window.__igv.loadBwTracks();
      const el = document.querySelector('#bwList'); if (el) el.scrollTop = 0;
      await new Promise(r => setTimeout(r, 1200)); })()`);
    await sleep(600);
    const sb = await box('#bwList');
    if (sb) {
      await shot(cdp, out('bam-tracks-sidebar.png'), {
        x: 0, y: Math.max(0, Math.round(sb.top - 34)), width: 214,
        height: Math.min(560, Math.round(sb.h + 40)) });
      log('bam-tracks-sidebar ok');
    }

    /* --------------------------------------------- 基因详情 -------------------- */
    await ev(`window.__igv.applyLabelW(250)`);
    await enableAll({ chrom: 'chr1', start: 11783000, end: 11807000, bw: false, genes: true });
    const gp = await ev(`(() => {
      const S = window.__igv.S;
      const g = (S.data.genes || []).find(x => x.name === 'MTHFR');
      if (!g) return null;
      window.__igv.toggleExpand(g);
      const L = window.__igv.geneLayout();
      const it = L.placed.find(i => i.g === g);
      const body = document.querySelector('.track[data-track="genes"] .track-body');
      const r = body.getBoundingClientRect();
      const bpPerPx = (S.view.end - S.view.start) / body.clientWidth;
      const exon = g.tx[0].exons[0];
      const bp = exon[0] + 300;
      return { x: r.left + (bp - S.view.start) / bpPerPx, y: r.top + (it.r + 0.5) * 22 }; })()`);
    if (gp) {
      await sleep(600);
      await rightClick(gp.x, gp.y);
      await sleep(400);
      let boxp = await box('#tpop');
      // 第一张：折叠状态（当前位置特征 + 内含子总数）
      if (boxp) {
        await shot(cdp, out('gene-feature-details.png'), {
          x: Math.max(0, Math.round(boxp.left - 12)), y: Math.max(0, Math.round(boxp.top - 10)),
          width: Math.round(boxp.w + 24), height: Math.round(Math.min(boxp.h + 20, 890 - boxp.top)) });
        log('gene-feature-details ok');
      }
      // 第二张：展开内含子清单
      await ev(`(() => { const d = document.querySelector('#tpop details'); if (d) d.open = true; })()`);
      await sleep(800);
      boxp = await box('#tpop');
      if (boxp) {
        await shot(cdp, out('gene-intron-list.png'), {
          x: Math.max(0, Math.round(boxp.left - 12)), y: Math.max(0, Math.round(boxp.top - 10)),
          width: Math.round(boxp.w + 24), height: Math.round(Math.min(boxp.h + 20, 1090 - boxp.top)) });
        log('gene-intron-list ok');
      }
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(400);

      // 第三张：悬停在内含子上
      await ev(`(async () => { const S = window.__igv.S;
        S.tracks.genes = true; window.__igv.ensureAll(true);
        await window.__igv.navigate('chr1', 11790300, 11793300);
        await new Promise(r => setTimeout(r, 1800)); })()`);
      const ip = await ev(`(() => { const S = window.__igv.S;
        const g = (S.data.genes || []).find(x => x.name === 'MTHFR');
        const L = window.__igv.geneLayout(); const it = L.placed.find(i => i.g === g);
        const body = document.querySelector('.track[data-track="genes"] .track-body');
        const r = body.getBoundingClientRect();
        const bpPerPx = (S.view.end - S.view.start) / body.clientWidth;
        const ex = g.tx[0].exons; const gap = (ex[0][1] + ex[1][0]) / 2;
        return { x: r.left + (gap - S.view.start) / bpPerPx, y: r.top + (it.r + 0.5) * 22 }; })()`);
      await mouse('mouseMoved', ip.x - 30, ip.y);
      await mouse('mouseMoved', ip.x, ip.y);
      await sleep(1000);
      const gt = await box('.track[data-track="genes"]');
      await shot(cdp, out('gene-intron-hover.png'), {
        x: 0, y: Math.max(0, Math.round(gt.top - 30)), width: 1010, height: 230 });
      log('gene-intron-hover ok');
    }

    /* ----------------------------------------------- SEG ---------------------- */
    await ev(`window.__igv.applyLabelW(240)`);
    await enableAll({ chrom: 'chr1', start: 1, end: 248956422, loaded: false,
      extra: `for (const t of S.bw.list) S.bw.on[t.id] = (t.id === 'TCGA-LUAD-05-4396-01A.seg');` });
    await sleep(800);
    b = await rows();
    await shot(cdp, out('import-seg-bar.png'), { x: 0, y: 0, width: 1440, height: Math.min(880, b.bottom + 6) });
    log('import-seg-bar ok');

    await ev(`(async () => { const S = window.__igv.S;
      for (const t of S.bw.list) S.bw.on[t.id] = true;
      window.__igv.loadBwTracks(); window.__igv.ensureAll(true);
      await new Promise(r => setTimeout(r, 1500));
      await window.__igv.navigate('chr1', 1, 60000000);
      await new Promise(r => setTimeout(r, 2600)); })()`);
    await sleep(800);
    b = await rows();
    await shot(cdp, out('import-seg-heatmap.png'), { x: 0, y: 0, width: 1440, height: Math.min(880, b.bottom + 6) });
    log('import-seg-heatmap ok');
  }

  if (SCOPE === 'custom') {
    await ev(`window.__igv.applyLabelW(200)`);
    /* 总览：40 kb 里 5 个基因 */
    await enableAll({ chrom: 'scaffold_1', start: 3000, end: 43000, bw: false, genes: false });
    await sleep(600);
    let b = await rows();
    await shot(cdp, out('custom-assembly.png'), { x: 0, y: 0, width: 1440, height: Math.min(880, b.bottom + 6) });
    log('custom-assembly ok');

    /* 折叠：15 kb */
    await ev(`(async () => { const S = window.__igv.S;
      window.__igv.ensureAll(true);
      await new Promise(r => setTimeout(r, 600));
      await window.__igv.navigate('scaffold_1', 5000, 20000);
      await new Promise(r => setTimeout(r, 1700)); })()`);
    await sleep(600);
    b = await rows();
    await shot(cdp, out('custom-genes-collapsed.png'), {
      x: 0, y: Math.max(0, b.top - 4), width: 1440, height: Math.min(300, b.bottom - b.top + 14) });
    log('custom-genes-collapsed ok');

    /* 展开单基因 */
    const tgt = await ev(`(async () => { const S = window.__igv.S;
      const t = (S.loaded.list || []).find(x => x.kind === 'gene');
      const data = S.loaded.data['0:' + t.id];
      const genes = (data && data.genes) || [];
      const g = genes.filter(x => (x.tx || []).length && (x.tx[0].exons || []).length >= 4)[0] || genes[0];
      if (!g) return null;
      window.__igv.toggleLoadedExpand(t, g, 0);
      window.__igv.ensureAll(true);
      await new Promise(r => setTimeout(r, 900));
      await window.__igv.navigate('scaffold_1', Math.max(0, g.start - 800), g.end + 800);
      await new Promise(r => setTimeout(r, 1700));
      return { name: g.name }; })()`);
    log('expanded', JSON.stringify(tgt));
    await sleep(600);
    b = await rows();
    await shot(cdp, out('custom-genes-expanded.png'), {
      x: 0, y: Math.max(0, b.top - 4), width: 1440, height: Math.min(340, b.bottom - b.top + 14) });
    log('custom-genes-expanded ok');

    /* 基因结构右键 */
    const hit = await ev(`(() => { const S = window.__igv.S;
      const t = (S.loaded.list || []).find(x => x.kind === 'gene');
      const data = S.loaded.data['0:' + t.id];
      const genes = (data && data.genes) || [];
      const g = genes.find(x => x.strand === '-') || genes[0];
      const row = document.querySelector('.track[data-loaded]');
      if (!row || !g) return null;
      const body = row.querySelector('.track-body'); const r = body.getBoundingClientRect();
      const bpPerPx = (S.view.end - S.view.start) / body.clientWidth;
      const exon = (g.tx && g.tx[0] && g.tx[0].exons) ? g.tx[0].exons[0] : null;
      const bp = exon ? Math.round((exon[0] + exon[1]) / 2) : Math.round((g.start + g.end) / 2);
      return { x: r.left + (bp - S.view.start) / bpPerPx, y: r.top + 12, name: g.name }; })()`);
    if (hit) {
      await rightClick(hit.x, hit.y);
      await ev(`(() => { const d = document.querySelector('#tpop details'); if (d) d.open = true; })()`);
      await sleep(700);
      const p = await box('#tpop');
      if (p) {
        await shot(cdp, out('custom-gene-details.png'), {
          x: Math.max(0, Math.round(p.left - 12)), y: Math.max(0, Math.round(p.top - 10)),
          width: Math.round(p.w + 24), height: Math.round(Math.min(p.h + 20, 890 - p.top)) });
        log('custom-gene-details ok');
      }
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(400);
    }

    /* 碱基级 */
    await ev(`(async () => { const S = window.__igv.S;
      S.tracks.seq = false; S.tracks.genes = false;
      window.__igv.ensureAll(true);
      await new Promise(r => setTimeout(r, 700));
      await window.__igv.navigate('scaffold_1', 9394, 9494);
      await new Promise(r => setTimeout(r, 1800)); })()`);
    await sleep(600);
    b = await rows();
    await shot(cdp, out('custom-sequence.png'), {
      x: 0, y: Math.max(0, b.top - 4), width: 1440, height: Math.min(300, b.bottom - b.top + 14) });
    log('custom-sequence ok');
  }

  await cdp.close();
}

main().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
