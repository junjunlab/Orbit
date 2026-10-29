// 在导入的基因轨道（正链 + 负链各一个基因）上抓 canvas fillText，
// 确认名字后面不再带链向字形（→ / ←）。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !window.__igv; i++) await sleep(100);
  const I = window.__igv;
  const out = {};

  const items = [...document.querySelectorAll('#loadedList .loaded-trk')];
  out.all = items.map((el) => el.dataset.loadedid);
  const el0 = items.find((el) => el.dataset.loadedid === 'arrowtest');
  out.found = !!el0;
  if (!el0) return out;

  const cb = el0.querySelector('input.on');
  if (cb && !cb.checked) { cb.checked = true; cb.onchange({ target: cb }); }
  await sleep(1000);

  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.fillText;
  const texts = [];
  proto.fillText = function (t, ...rest) { texts.push(String(t)); return orig.call(this, t, ...rest); };
  await I.navigate('chr7', 55017000, 55035000, { force: true });
  await sleep(1800);
  proto.fillText = orig;

  out.total = texts.length;
  out.geneLabels = texts.filter((t) => /TST/.test(t));
  out.withArrow = texts.filter((t) => /[→←]/.test(t));
  // 链向仍应通过图形表达：画布上应有非空的 3′ 三角箭头（靠像素检查太脆，
  // 这里只记录画布尺寸，方向靠人工看截图）
  const t = document.querySelector('.track[data-loaded="arrowtest"] canvas');
  out.canvas = t ? [t.clientWidth, t.clientHeight] : null;
  return out;
})();
