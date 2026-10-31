/* 深色下各面板「位置」输入框的背景/边框是否一致（是否被 :focus 样式染色） */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  document.body.setAttribute('data-theme', 'dark');
  ig.setPanelCount(2); await sleep(1200);
  const phs = [...document.querySelectorAll('#paneHeads .ph')];
  return phs.map((ph, i) => {
    const inp = ph.querySelector('.ph-in');
    const a = getComputedStyle(ph), b = getComputedStyle(inp);
    return {
      i, act: ig.S.act === i, focused: document.activeElement === inp,
      phBg: a.backgroundColor, phRadius: a.borderRadius,
      inBg: b.backgroundColor, inShadow: b.boxShadow, inBorder: b.border,
    };
  });
})()
