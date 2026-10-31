// Verify the track-settings colour panel: preset swatches + arbitrary colour picker.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const result = {};

  // wait for bigWig data
  let tries = 0;
  while (tries++ < 60) {
    const cs = [...document.querySelectorAll('.track[data-bw] canvas')];
    if (cs.length >= 1) break;
    await wait(200);
  }

  // open the settings popover on the first bigWig track
  const gear = document.querySelector('.track[data-bw] .tgear');
  gear.click();
  await wait(250);
  const pop = document.getElementById('tpop');
  result.popVisible = !pop.hidden;

  // preset swatches
  result.presetSwatches = document.querySelectorAll('#tpop .chips .chip').length;

  // arbitrary colour control (native colour input inside the custom chip)
  const custom = document.querySelector('#tpop .chip-custom input[type="color"]');
  result.hasCustomPicker = !!custom;
  result.customLabel = (document.querySelector('#tpop .chip-custom span') || {}).textContent;

  // apply an arbitrary colour and check it propagates
  const before = document.querySelector('#bwList .bw-trk .sw').style.background;
  if (custom) {
    custom.value = '#c2410c';
    custom.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await wait(300);
  const after = document.querySelector('#bwList .bw-trk .sw').style.background;
  result.swatchBefore = before;
  result.swatchAfter = after;
  result.colorApplied = after.toLowerCase() === 'rgb(194, 65, 12)';

  // the stored pref must carry the arbitrary colour
  const prefs = JSON.parse(localStorage.getItem('igvlocal.prefs.v1') || '{}');
  result.storedColor = (prefs.bwCfg && prefs.bwCfg[Object.keys(prefs.bwCfg)[0]] || {}).color;

  return JSON.stringify(result);
})();
