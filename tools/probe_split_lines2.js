(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 100 && !window.__igv; i++) await sleep(100);
  const I = window.__igv;
  const out = { dpr: window.devicePixelRatio };

  const inp = document.querySelector('#locus');
  inp.focus();
  inp.value = 'ACTB, JUN, TPBGL';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  for (let i = 0; i < 80 && I.S.panels.length < 3; i++) await sleep(150);
  await sleep(1500);

  const view = document.querySelector('#view');
  const ov = view.querySelector(':scope > .split-lines');
  out.hasOverlay = !!ov;
  if (!ov) return out;
  const vb = view.getBoundingClientRect();
  out.viewRect = { left: +vb.left.toFixed(3), width: +vb.width.toFixed(3) };
  out.childCount = ov.children.length;
  out.lines = [...ov.children].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      styleLeft: el.style.left,
      styleWidth: el.style.width || getComputedStyle(el).width,
      rectLeft: +r.left.toFixed(4),
      rectWidth: +r.width.toFixed(4),
      devLeft: +((r.left - vb.left) * out.dpr).toFixed(4),
      devWidth: +(r.width * out.dpr).toFixed(4),
      frac: +(((r.left - vb.left) * out.dpr) % 1).toFixed(4),
    };
  });
  out.panes = [...document.querySelectorAll('.track[data-track="ruler"] .pane')].map((p) => {
    const r = p.getBoundingClientRect();
    return { p: p.dataset.p, left: +r.left.toFixed(4), width: +r.width.toFixed(4) };
  });
  return out;
})()
