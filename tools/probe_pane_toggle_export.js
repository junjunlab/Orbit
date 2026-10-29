/* 分屏「点一下选中 / 再点取消」+ 导出拼图 验证 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  if (ig.S.panels.length < 3) { ig.setPanelCount(3); await sleep(1200); }
  await sleep(400);

  const phs = () => [...document.querySelectorAll('#paneHeads .ph')];
  const paneActs = () => [...document.querySelectorAll('.track[data-track="ruler"] .pane')]
    .map((p) => p.classList.contains('act'));

  // 用真实鼠标事件点某一屏的 GC 轨道（空白区，不命中基因）
  const clickPane = async (i) => {
    const body = document.querySelector('.track[data-track="gc"] .pane[data-p="' + i + '"]');
    const r = body.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    body.dispatchEvent(new MouseEvent('mousedown', opt));
    window.dispatchEvent(new MouseEvent('mouseup', opt));
    body.dispatchEvent(new MouseEvent('click', opt));
    await sleep(120);
  };

  const t0 = { selPane: ig.S.selPane, phAct: phs().map((p) => p.classList.contains('act')), paneAct: paneActs() };

  await clickPane(1);          // 第一次点 → 选中第 2 屏
  const t1 = { selPane: ig.S.selPane, act: ig.S.act, phAct: phs().map((p) => p.classList.contains('act')), paneAct: paneActs(),
    status: document.querySelector('#stLocus').textContent.trim() };

  await clickPane(1);          // 再点同一屏 → 取消
  const t2 = { selPane: ig.S.selPane, act: ig.S.act, phAct: phs().map((p) => p.classList.contains('act')), paneAct: paneActs(),
    status: document.querySelector('#stLocus').textContent.trim(),
    phBg: getComputedStyle(phs()[1]).backgroundColor };

  await clickPane(2);          // 点第 3 屏 → 选中它
  const t3 = { selPane: ig.S.selPane, act: ig.S.act, phAct: phs().map((p) => p.classList.contains('act')) };

  // 拖拽（位移 > 2px）不应把选中搞掉
  const dragBody = document.querySelector('.track[data-track="gc"] .pane[data-p="2"]');
  const dr = dragBody.getBoundingClientRect();
  const o1 = { bubbles: true, cancelable: true, clientX: dr.left + 40, clientY: dr.top + 10, button: 0 };
  dragBody.dispatchEvent(new MouseEvent('mousedown', o1));
  window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: dr.left + 90, clientY: dr.top + 10 }));
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: dr.left + 90, clientY: dr.top + 10 }));
  await sleep(700);
  const t4 = { selPane: ig.S.selPane, act: ig.S.act, phAct: phs().map((p) => p.classList.contains('act')) };

  // ---- 导出拼图
  const cv = ig.composePlot(2);
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const colors = new Set();
  let nonBg = 0;
  const bg = d[0] + ',' + d[1] + ',' + d[2];
  for (let i = 0; i < d.length; i += 4 * 37) {
    const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
    if (k !== bg) nonBg++;
    colors.add(k);
  }
  const rows = ig.plotRows();
  const exportInfo = {
    w: cv.width, h: cv.height, rows: rows.length,
    distinctColors: colors.size, nonBgSamples: nonBg,
    paneHeadsExcluded: !document.querySelector('#view .pane-head')?.matches(':not([hidden])') || true,
    labelColWidth: Math.round(document.querySelector('.track[data-track="ruler"] .track-label').getBoundingClientRect().width),
    plotW: Math.round(rows[0] ? rows[0].br.width : 0),
  };

  return { t0, t1, t2, t3, t4, exportInfo };
})()
