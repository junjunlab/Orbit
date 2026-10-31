// 文档配图 + 导出校验（一个进程内完成，避免反复上传 180 MB BAM）
// 用法：node tools/doc_shots.js [empty|bam|align|sidebar|gene|export|en|all]
const fs = require('fs');
const path = require('path');
const { open, goto, importFiles, shot, sleep, BASE, OUT } = require('./doc_session');

const BAM1 = 'C:/Users/JunJun/Desktop/SRR22507537.chr1.bam';
const BAM2 = 'C:/Users/JunJun/Desktop/SRR22507537.chr2.bam';
const BID = 'SRR22507537.chr1';
const STAGE = process.argv[2] || 'all';
const log = (...a) => console.log('[doc]', ...a);

async function main() {
  const tall = STAGE === 'gene' || STAGE === 'all' || STAGE === 'sidebar';
  const { cdp, ev } = await open({ width: 1440, height: STAGE === 'gene' ? 1420 : (tall ? 1100 : 900) });
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
    await sleep(600);
  };
  const box = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return null; const r = e.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height,
             top: r.top, bottom: r.bottom, left: r.left, right: r.right }; })()`);
  const rowsInfo = () => ev(`Array.from(document.querySelectorAll('#view .track')).filter(e => !e.hidden)
    .map(e => ({ id: e.dataset.bw || e.dataset.align || e.dataset.junc || e.dataset.track,
      name: (e.querySelector('.nm') || {}).textContent || '',
      top: Math.round(e.getBoundingClientRect().top),
      h: Math.round(e.getBoundingClientRect().height) }))`);

  const enableBam = (only = BID) => ev(`(async () => { const S = window.__igv.S;
    for (const t of S.bw.list) if (t.format === 'bam') S.bw.on[t.id] = (t.id === ${JSON.stringify(only)});
    S.bw.on[${JSON.stringify(only)} + '::align'] = true;
    window.__igv.applyLabelW(250); window.__igv.loadBwTracks(); window.__igv.ensureAll(true);
    for (let i = 0; i < 400; i++) {
      const P = S.panels[0];
      if (P.bwData[${JSON.stringify(only)}] && P.bwData[${JSON.stringify(only)}].bins) break;
      await new Promise(r => setTimeout(r, 250));
    }
    await new Promise(r => setTimeout(r, 1600));
    const P = S.panels[0];
    return { align: ((P.alignData || {})[${JSON.stringify(only)}] || {}).reads
      ? P.alignData[${JSON.stringify(only)}].reads.length : 0 }; })()`);

  const ensureImported = async () => {
    const n0 = await ev(`(window.__igv.S.bw.list || []).filter(t => t.format === 'bam').length`);
    if (n0 >= 2) return;
    const t0 = Date.now();
    await importFiles(cdp, ev, [BAM1, BAM2]);
    for (let i = 0; i < 900; i++) {
      const n = await ev(`(window.__igv.S.bw.list || []).filter(t => t.format === 'bam').length`);
      if (n >= 2) break;
      await sleep(400);
    }
    log('import done in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  };

  await goto(ev, cdp, `${BASE}/?db=hg38&locus=chr1:11,792,000-11,800,000`);

  /* ---------------------------------------------------------------- 0. 空启动 */
  if (STAGE === 'empty' || STAGE === 'all') {
    await ev(`window.__igv.applyLabelW(200)`);
    await sleep(500);
    const r = await rowsInfo();
    log('empty rows:', JSON.stringify(r.map((x) => x.id)));
    await shot(cdp, 'launch-empty.png', { x: 0, y: 0, width: 1440,
      height: Math.min(tall ? 1100 : 900, Math.max(...r.map((x) => x.top + x.h)) + 6) });
  }

  /* ------------------------------------------------------- 1. 三轨道（单样本） */
  if (STAGE === 'bam' || STAGE === 'all') {
    await ensureImported();
    log('reads:', JSON.stringify(await enableBam()));
    await sleep(1500);
    const r = await rowsInfo();
    log('bam rows:', JSON.stringify(r.map((x) => [x.name, x.top, x.h])));
    await shot(cdp, 'bam-three-tracks.png', { x: 0, y: 0, width: 1440,
      height: Math.min(tall ? 1100 : 900, Math.max(...r.map((x) => x.top + x.h)) + 6) });
  }

  /* ------------------------------------------------ 2. Alignments 显示模式菜单 */
  if (STAGE === 'align' || STAGE === 'all') {
    await ensureImported();
    await enableBam();
    await sleep(1200);
    const ae = await box(`.track[data-align="${BID}"] .track-label`);
    await rightClick(ae.cx, ae.cy);
    const pop = await box('#tpop');
    log('popover:', JSON.stringify(pop));
    if (pop) {
      await shot(cdp, 'bam-align-menu.png', {
        x: Math.max(0, Math.round(pop.left - 16)), y: Math.max(0, Math.round(pop.top - 12)),
        width: Math.round(pop.w + 32), height: Math.round(pop.h + 24) });
    }
  }

  /* --------------------------------------------------- 3. 侧栏：两份 BAM 的子轨道 */
  if (STAGE === 'sidebar' || STAGE === 'all') {
    await ensureImported();
    await ev(`(async () => { const S = window.__igv.S;
      for (const t of S.bw.list) if (t.format === 'bam') { S.bw.on[t.id] = true; S.bw.on[t.id + '::align'] = true; }
      window.__igv.loadBwTracks(); window.__igv.ensureAll(true);
      const el = document.querySelector('#bwList'); if (el) el.scrollTop = 0;
      await new Promise(r => setTimeout(r, 1200)); })()`);
    await sleep(800);
    const sb = await box('#bwList');
    log('sidebar:', JSON.stringify(sb));
    if (sb) {
      await shot(cdp, 'bam-tracks-sidebar.png', {
        x: 0, y: Math.max(0, Math.round(sb.top - 34)), width: 214,
        height: Math.min(560, Math.round(sb.h + 40)) });
    }
  }

  /* ------------------------------------------------------------- 4. 基因结构详情 */
  if (STAGE === 'gene' || STAGE === 'all') {
    await ev(`window.__igv.navigate('chr1', 11783000, 11807000)`);
    await sleep(1800);
    const pos = await ev(`(() => {
      const S = window.__igv.S;
      const g = (S.data.genes || []).find(x => x.name === 'MTHFR');
      if (!g) return { err: 'no MTHFR' };
      window.__igv.toggleExpand(g);
      const L = window.__igv.geneLayout();
      const it = L.placed.find(i => i.g === g);
      const body = document.querySelector('.track[data-track="genes"] .track-body');
      const r = body.getBoundingClientRect();
      const bpPerPx = (S.view.end - S.view.start) / body.clientWidth;
      const exon = g.tx[0].exons[0];
      const bp = exon[0] + 300;
      return { row: it.r, bp, x: r.left + (bp - S.view.start) / bpPerPx,
               y: r.top + (it.r + 0.5) * 22, tx: g.tx[0].name }; })()`);
    log('gene pos:', JSON.stringify(pos));
    await sleep(900);
    await rightClick(pos.x, pos.y);
    const geo = await ev(`(() => { const p = document.querySelector('#tpop');
      const list = Array.from(p.children).find(el => el.style && el.style.maxHeight);
      const pr = p.getBoundingClientRect(); const lr = list.getBoundingClientRect();
      list.scrollTop = 0;
      return { left: pr.left, top: pr.top, w: pr.width, listBottom: lr.bottom,
               listH: lr.height, listScroll: list.scrollHeight }; })()`);
    await sleep(500);
    log('gene popover:', JSON.stringify(geo));
    const cropH = Math.round(geo.listBottom - geo.top + 14);
    await shot(cdp, 'gene-feature-details.png', {
      x: Math.max(0, Math.round(geo.left - 12)), y: Math.max(0, Math.round(geo.top - 10)),
      width: Math.round(geo.w + 24), height: cropH });
    // 展开「全部内含子」后，滚动区自动把清单滚进可视范围
    await ev(`(() => { const p = document.querySelector('#tpop');
      const d = p.querySelector('details'); if (d) d.open = true; })()`);
    await sleep(700);
    log('after open:', JSON.stringify(await ev(`(() => { const p = document.querySelector('#tpop');
      const list = Array.from(p.children).find(el => el.style && el.style.maxHeight);
      const pr = p.getBoundingClientRect(); const lr = list.getBoundingClientRect();
      return { top: pr.top, listTop: lr.top, listBottom: lr.bottom, scrollTop: list.scrollTop }; })()`)));
    const g2 = await box('#tpop');
    await shot(cdp, 'gene-intron-list.png', {
      x: Math.max(0, Math.round(g2.left - 12)), y: Math.max(0, Math.round(g2.top - 10)),
      width: Math.round(g2.w + 24), height: Math.round(Math.min(g2.h + 16, (STAGE === 'gene' ? 1420 : (tall ? 1100 : 900)) - g2.top - 4)) });
    // 先关掉弹窗，否则鼠标落点被弹窗挡住，悬停提示不会出现
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(400);
    // 悬停在内含子上
    await ev(`window.__igv.navigate('chr1', 11790300, 11793300)`);
    await sleep(1700);
    const ipos = await ev(`(() => {
      const S = window.__igv.S;
      const g = (S.data.genes || []).find(x => x.name === 'MTHFR');
      const L = window.__igv.geneLayout();
      const it = L.placed.find(i => i.g === g);
      const body = document.querySelector('.track[data-track="genes"] .track-body');
      const r = body.getBoundingClientRect();
      const bpPerPx = (S.view.end - S.view.start) / body.clientWidth;
      const ex = g.tx[0].exons;
      const gap = (ex[0][1] + ex[1][0]) / 2;
      return { gap, x: r.left + (gap - S.view.start) / bpPerPx, y: r.top + (it.r + 0.5) * 22 }; })()`);
    await mouse('mouseMoved', ipos.x - 30, ipos.y);
    await mouse('mouseMoved', ipos.x, ipos.y);
    await sleep(1000);
    const tip = await box('.tip');
    log('tip:', JSON.stringify(await ev(`(() => { const t = document.querySelector('.tip');
      return t && !t.hidden ? t.textContent : null; })()`)));
    if (tip) {
      const gt = await box('.track[data-track="genes"]');
      await shot(cdp, 'gene-intron-hover.png', {
        x: 0, y: Math.max(0, Math.round(gt.top - 30)), width: 1010, height: 230 });
    }
  }

  /* ---------------------------------------------------------------- 5. 导出校验 */
  if (STAGE === 'export' || STAGE === 'all') {
    await goto(ev, cdp, `${BASE}/?db=hg38&locus=chr1:11,792,000-11,800,000`);
    await ensureImported();
    await enableBam();
    await sleep(1500);
    const dir = path.join(OUT, '_export');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
    const before = await ev(`(() => ({ rows: Array.from(document.querySelectorAll('#view .track'))
        .filter(e => !e.hidden && e.querySelector('.track-body'))
        .map(e => ({ name: (e.querySelector('.nm') || {}).textContent || '',
                     h: Math.round(e.querySelector('.track-body').getBoundingClientRect().height) })),
      locus: (document.querySelector('#stLocus') || {}).textContent || '',
      scale: (document.querySelector('#stScale') || {}).textContent || '',
      viewW: Math.round(document.querySelector('#view').clientWidth),
      labelW: window.__igv.S.labelW }))()`);
    log('window:', JSON.stringify(before));
    await shot(cdp, '_window-for-export.png', { x: 0, y: 0, width: 1440, height: 470 });
    // 只截 #view（含标签列），和导出图同一块内容，便于逐像素比对
    const vr = await box('#view');
    await shot(cdp, '_view-crop.png', { x: Math.round(vr.left), y: Math.round(vr.top),
      width: Math.round(vr.w), height: Math.round(vr.h) });
    for (const kind of ['png', 'svg', 'pdf']) {
      await ev(`window.__igv.doExport(${JSON.stringify(kind)})`);
      await sleep(7000);
    }
    log('downloads:', JSON.stringify(fs.readdirSync(dir).map((f) => [f, fs.statSync(path.join(dir, f)).size])));
  }

  /* ------------------------------------------------------ 6. 英文界面（设置弹窗） */
  if (STAGE === 'en' || STAGE === 'all') {
    await ev(`localStorage.setItem('orbit.lang', 'en')`);
    await goto(ev, cdp, `${BASE}/?db=hg38&locus=chr1:11,792,000-11,800,000`);
    log('lang:', await ev(`document.documentElement.lang`));
    await ensureImported();
    await enableBam();
    await sleep(1200);
    const gear = await box(`.track[data-bw="${BID}"] .tgear`);
    await click(gear.cx, gear.cy);
    const pop = await box('#tpop');
    log('en popover:', JSON.stringify(pop));
    if (pop) {
      await shot(cdp, 'bam-settings-en.png', {
        x: Math.max(0, Math.round(pop.left - 16)), y: Math.max(0, Math.round(pop.top - 12)),
        width: Math.round(pop.w + 32), height: Math.round(pop.h + 24) });
    }
    await click(1200, 760);                     // 点空白处关掉弹窗
    await sleep(400);
    const ae = await box(`.track[data-align="${BID}"] .track-label`);
    await rightClick(ae.cx, ae.cy);
    const ap = await box('#tpop');
    if (ap) {
      await shot(cdp, 'bam-align-menu-en.png', {
        x: Math.max(0, Math.round(ap.left - 16)), y: Math.max(0, Math.round(ap.top - 12)),
        width: Math.round(ap.w + 32), height: Math.round(ap.h + 24) });
    }
  }

  await cdp.close();
}

main().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
