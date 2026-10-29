// In-page test: verify bigWig bar rendering, multi-select, and Group Autoscale.
// Loaded via tools/cdp_shot.js as the jsFile argument.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function imgNonBlank(canvas) {
    try {
      const ctx = canvas.getContext('2d');
      const { width, height } = canvas;
      const d = ctx.getImageData(0, 0, width, height).data;
      let colored = 0;
      for (let i = 0; i < d.length; i += 4) {
        // count pixels clearly darker than the white canvas background
        if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) colored++;
      }
      return colored;
    } catch (e) { return -1; }
  }

  // wait for the bigWig canvases to have rendered content
  let tries = 0;
  while (tries++ < 80) {
    const cs = [...document.querySelectorAll('.track[data-bw] canvas')];
    if (cs.length >= 2 && cs.every((c) => imgNonBlank(c) > 50)) break;
    await wait(200);
  }
  const list = [...document.querySelectorAll('#bwList .bw-trk')];
  const result = { rows: list.length, canvases: document.querySelectorAll('.track[data-bw] canvas').length };

  // --- measure bar-ness: bars paint tall vertical coverage; a pure line would not ---
  const sampleCanvas = document.querySelector('.track[data-bw] canvas');
  result.canvasColoredPixels = imgNonBlank(sampleCanvas);

  // --- multi-select two tracks ---
  // NOTE: each click triggers renderBwList() which rebuilds the list, so we must
  // re-query the live DOM nodes after every interaction.
  let live = () => [...document.querySelectorAll('#bwList .bw-trk')];
  live()[0].querySelector('.nm').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  live = () => [...document.querySelectorAll('#bwList .bw-trk')];
  live()[1].querySelector('.nm').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  result.selAfterClick = [...document.querySelectorAll('#bwList .bw-trk.sel')].map((r) => r.dataset.bwid);

  // --- right-click a selected row -> context menu ---
  const target = document.querySelector('#bwList .bw-trk.sel');
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, clientX: rect.left + 10, clientY: rect.top + 10,
  }));
  await wait(200);
  result.ctxVisible = !document.getElementById('bwCtx').hidden;
  result.ctxItems = [...document.querySelectorAll('#bwCtx .ctx-item')].map((b) => b.textContent.trim());

  // --- click "Group Autoscale" (first item) ---
  const ga = document.querySelector('#bwCtx .ctx-item');
  if (ga) ga.click();
  await wait(500);

  // --- verify persisted prefs + shared scale evidence ---
  const prefs = JSON.parse(localStorage.getItem('igvlocal.prefs.v1') || '{}');
  result.groups = prefs.bwGroups;
  // cfg only stores overrides; confirm the two tracks share a group id
  const cfg = prefs.bwCfg || {};
  const ids = result.selAfterClick;
  const g1 = ids[0] && cfg[ids[0]] && cfg[ids[0]].group;
  const g2 = ids[1] && cfg[ids[1]] && cfg[ids[1]].group;
  result.sharedGroupId = (g1 === g2 && g1) ? g1 : null;

  // the two grouped tracks should now show identical axis labels (共享)
  const subs = [...document.querySelectorAll('.track[data-bw] .sub')].map((s) => s.textContent.trim());
  result.subs = subs;
  const badges = [...document.querySelectorAll('#bwList .bw-trk .grp')].map((b) => b.textContent.trim());
  result.badges = badges;

  return JSON.stringify(result);
})();
