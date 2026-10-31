// 列出已导入轨道，并在导入的基因轨道上抓取所有 canvas fillText 文本，
// 检查标签是否还带链向字形（→ / ←）。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !window.__igv; i++) await sleep(100);
  const I = window.__igv;
  const out = { tracks: [] };

  const items = [...document.querySelectorAll('#loadedList .loaded-trk')];
  out.n = items.length;
  out.tracks = items.map((el) => ({
    id: el.dataset.loadedid,
    kind: el.dataset.kind || '',
    text: (el.textContent || '').trim().slice(0, 40),
  }));

  // 挑一个基因/注释类轨道（有多转录本 = 会走 drawLoadedGeneTrack）
  const gene = items.find((el) => /gene|gtf|gff/i.test(el.dataset.kind || '') ||
    /gtf|gff|注释/i.test(el.textContent || '')) || items[0];
  out.picked = gene ? gene.dataset.loadedid : null;
  if (!gene) return out;

  const cb = gene.querySelector('input.on');
  if (cb && !cb.checked) { cb.checked = true; cb.onchange({ target: cb }); }
  await sleep(1200);

  // 抓文本：在渲染前包住 fillText
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.fillText;
  const texts = [];
  proto.fillText = function (t, ...rest) { texts.push(String(t)); return orig.call(this, t, ...rest); };

  const el = document.querySelector(`.track[data-loaded="${out.picked}"]`);
  out.trackFound = !!el;
  if (el) {
    // 缩到一个能看见名字的尺度
    await I.navigate('chr7', 55019000, 55212000, { force: true });
    await sleep(1800);
    await I.scheduleRender && I.scheduleRender();
    await sleep(600);
  }
  proto.fillText = orig;

  out.total = texts.length;
  out.withArrow = texts.filter((t) => /[→←]/.test(t));
  out.sample = texts.filter((t) => t.length > 2 && /[A-Za-z]/.test(t)).slice(0, 14);
  return out;
})();
