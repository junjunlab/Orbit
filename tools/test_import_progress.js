(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  for (let i = 0; i < 80 && !window.__igv; i++) await sleep(100);
  if (!window.__igv) { out.error = 'no hook'; return out; }
  const S = window.__igv.S;
  const panel = document.getElementById('impPanel');
  const statusEl = document.getElementById('impStatus');
  const bar = document.getElementById('impBar');

  // 造一个 3 万基因的 GTF（约 6 万行），让「解析中」阶段可观察
  const lines = [];
  for (let i = 0; i < 30000; i++) {
    const s = 1000 + i * 800, e = s + 500;
    lines.push(`chr2\tt\tgene\t${s}\t${e}\t.\t+\t.\tgene_id "IG${i}"; gene_name "ImpGene${i}";`);
    lines.push(`chr2\tt\texon\t${s}\t${e}\t.\t+\t.\tgene_id "IG${i}"; transcript_id "IG${i}.t1";`);
  }
  const file = new File([lines.join('\n')], 'import_test.gtf', { type: 'text/plain' });

  const p = window.__igv.importFiles([file]);
  const samples = [];
  for (let i = 0; i < 120; i++) {
    await sleep(40);
    const cls = panel.className;
    samples.push({ h: panel.hidden, cls, w: bar.style.width, st: statusEl.textContent });
    if (cls.includes('done') || cls.includes('err')) break;
  }
  await p;
  await sleep(150);

  out.panelExists = !!panel;
  out.sawShown = samples.some((s) => s.h === false);
  out.sawIndet = samples.some((s) => s.cls.includes('indet'));
  out.sawDone = samples.some((s) => s.cls.includes('done'));
  out.finalClass = panel.className;
  out.finalStatus = statusEl.textContent;
  out.samples = samples.slice(0, 10);
  out.loaded = S.loaded.list.map((t) => `${t.id}:${t.name}:${t.genes || 0}`);
  out.gtfBoxHidden = document.getElementById('gtfWrap').hidden;

  // 清理：删掉刚导入的测试轨道，避免污染 data/loaded
  const t = S.loaded.list.find((x) => x.name === 'import_test.gtf');
  if (t) {
    try { await fetch(`api/loaded?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' }); } catch { /* ignore */ }
    out.cleaned = true;
  }
  return out;
})()
