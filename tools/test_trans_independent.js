(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !window.__igv; i++) await sleep(100);
  const I = window.__igv, S = I.S;

  // 勾上导入轨道，让两条序列轨道同时可见
  const cb = document.querySelector('#loadedList .loaded-trk[data-loadedid="indep_test"] input.on');
  if (cb && !cb.checked) { cb.checked = true; cb.onchange({ target: cb }); }
  await sleep(500);

  I.setTransTable(1);
  await I.navigate('chr7', 5527700, 5527810, { force: true });
  await sleep(1800);

  const hOf = (sel) => {
    const cv = document.querySelector(sel);
    if (!cv) return null;
    return +cv.getBoundingClientRect().height.toFixed(1);
  };
  const SEQ = '.track[data-track="seq"] canvas';
  const LOD = '.track[data-loaded="indep_test"] canvas';
  const pressed = (sel) => {
    const b = document.querySelector(sel);
    return b ? b.getAttribute('aria-pressed') : null;
  };
  const base = { seq: hOf(SEQ), loaded: hOf(LOD) };

  const out = { base, steps: [] };

  const measure = async (label) => {
    await sleep(500);
    out.steps.push({
      label,
      seqH: hOf(SEQ), loadedH: hOf(LOD),
      seqOn: I.transOnFor('seq'), loadedOn: I.transOnFor('indep_test'),
      seqBtn: pressed('#seqTrans'),
      loadedBtn: pressed('.sflip[data-transid="indep_test"]'),
    });
  };

  // A: 都关
  I.setSeqTrans(false);
  I.setLoadedTrans('indep_test', false);
  await measure('both off');

  // B: 只开内置
  I.setSeqTrans(true);
  await measure('seq only');

  // C: 只开导入
  I.setSeqTrans(false);
  I.setLoadedTrans('indep_test', true);
  await measure('loaded only');

  // D: 都开
  I.setSeqTrans(true);
  await measure('both on');

  // E: 弹层是不是各自指向自己的轨道
  document.querySelector('.sflip[data-transid="indep_test"]').click();
  await sleep(250);
  const popLoaded = {
    key: document.getElementById('transPop').dataset.key,
    hidden: document.getElementById('transPop').hidden,
    checked: document.getElementById('transOn').checked,
  };
  document.querySelector('#seqTrans').click();
  await sleep(250);
  const popSeq = {
    key: document.getElementById('transPop').dataset.key,
    hidden: document.getElementById('transPop').hidden,
    checked: document.getElementById('transOn').checked,
  };
  out.pop = { popLoaded, popSeq };
  I.closeTransPop();

  out.AA_H = 42;
  return out;
})()
