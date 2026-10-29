/* 分屏交互与单屏回归 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);

  // --- 1) 单屏仍是原样 ---
  ig.setPanelCount(1);
  await sleep(700);
  out.single = {
    panels: ig.S.panels.length,
    paneRows: document.querySelectorAll('#view .track-body.panes').length,
    paneEls: document.querySelectorAll('#view .pane').length,
    headHidden: document.querySelector('#paneHead').hidden,
    genes: ig.S.data.genes.length,
    genesCanvasW: document.querySelector('.track[data-track="genes"] canvas').width,
  };

  // --- 2) 两屏 + 第二屏点选基因 ---
  ig.setPanelCount(2);
  await sleep(400);
  await ig.goPanel(1, 'BRCA1');
  await sleep(1400);
  const P = ig.S.panels[1];
  const g = (P.data.genes || [])[0];
  out.pane2 = { view: P.view, genes: P.data.genes.length, firstGene: g && g.name };

  const cv = document.querySelector('.track[data-track="genes"] .pane[data-p="1"] canvas');
  const r = cv.getBoundingClientRect();
  const w = cv.clientWidth;
  const px = (bp) => (bp - P.view.start) / ((P.view.end - P.view.start) / w);
  const gy = (g.start + g.end) / 2;
  const x = Math.max(2, Math.min(w - 2, px(gy)));
  cv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + x, clientY: r.top + 10 }));
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  cv.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + x, clientY: r.top + 10 }));
  await sleep(500);
  out.click = {
    act: ig.S.act,
    sel: ig.S.sel && ig.S.sel.name,
    expect: g && g.name,
  };

  // --- 3) 关掉第二屏 ---
  ig.closePanel(1);
  await sleep(600);
  out.afterClose = { panels: ig.S.panels.length, paneEls: document.querySelectorAll('#view .pane').length,
    headHidden: document.querySelector('#paneHead').hidden };

  // --- 4) 持久化 ---
  ig.setPanelCount(2);
  await sleep(500);
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem('igvlocal.prefs.v1') || '{}'); } catch { /* ignore */ }
  out.prefsSplit = prefs.split ? { count: prefs.split.count, loci: prefs.split.loci.length } : null;
  return out;
})()
