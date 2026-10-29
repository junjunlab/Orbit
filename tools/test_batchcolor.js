// Verify: multi-select in the sidebar + right-click -> unified colour for all
// selected tracks.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const live = () => [...document.querySelectorAll('#bwList .bw-trk')];

  let tries = 0;
  while (tries++ < 90) {
    if (live().length >= 2) break;
    await wait(200);
  }
  out.rows = live().length;

  // select two tracks (plain click then ctrl+click)
  live()[0].querySelector('.nm').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  live()[1].querySelector('.nm').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  out.selected = [...document.querySelectorAll('#bwList .bw-trk.sel')].map((r) => r.dataset.bwid);

  // right-click one of them
  const target = document.querySelector('#bwList .bw-trk.sel');
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, clientX: rect.left + 10, clientY: rect.top + 10,
  }));
  await wait(200);

  const menu = document.getElementById('bwCtx');
  out.menuVisible = !menu.hidden;
  out.menuItems = [...menu.querySelectorAll('.ctx-item')].map((b) => b.textContent.trim());
  out.paletteChips = menu.querySelectorAll('.ctx-colors .chip').length;
  out.hasCustomPicker = !!menu.querySelector('.ctx-colors .chip-custom input[type="color"]');

  // pick a preset colour (3rd swatch) -> both selected tracks must change
  const before = live().filter((r) => r.classList.contains('sel'))
    .map((r) => r.querySelector('.sw').style.background);
  const chip = menu.querySelectorAll('.ctx-colors .chip')[2];
  const want = chip.dataset.c;
  chip.click();
  await wait(400);
  const after = live().filter((r) => r.classList.contains('sel'))
    .map((r) => r.querySelector('.sw').style.background);

  out.colorBefore = before;
  out.colorAfter = after;
  out.picked = want;

  // every selected track must now carry the same colour in the stored prefs
  const prefs = JSON.parse(localStorage.getItem('igvlocal.prefs.v1') || '{}');
  const cfg = prefs.bwCfg || {};
  out.storedColors = out.selected.map((id) => (cfg[id] || {}).color);
  out.allSame = out.storedColors.every((c) => c && c.toLowerCase() === want);
  out.menuStillOpen = !document.getElementById('bwCtx').hidden;

  return JSON.stringify(out);
})();
