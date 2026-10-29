/* 分屏 + 导入的 GTF 轨道：确认竖线在 loaded 轨道上也贯穿到底，并截图 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 160 && !(window.__igv && window.__igv.S.asm); i++) await sleep(100);
  const input = document.querySelector('#locus');
  input.focus();
  input.value = 'TP53, IGF2BP1, IGF2BP2';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  for (let i = 0; i < 80 && window.__igv.S.panels.length < 3; i++) await sleep(150);
  await sleep(800);

  // 造一份多转录本的 GTF（在页面里直接建 File，走真实导入路径）
  const lines = [];
  const add = (feat, s, e, gid, gname, tid) => lines.push(
    `chr17\ttest\t${feat}\t${s}\t${e}\t.\t+\t.\tgene_id "${gid}"; transcript_id "${tid}"; gene_name "${gname}";`);
  const G = [['ENSG00000141510', 'TP53', 7668402, 7687550],
             ['ENSG00000116288', 'PARK7', 7950000, 8000000]];
  for (const [gid, gname, base, end] of G) {
    add('gene', base, end, gid, gname, gid);
    for (let t = 0; t < 4; t++) {
      const tid = `${gid}.${t + 1}`;
      add('transcript', base, end, gid, gname, tid);
      for (let x = 0; x < 6; x++) {
        const s = base + x * 800 + t * 60;
        add('exon', s, s + 180, gid, gname, tid);
        add('CDS', s + 20, s + 150, gid, gname, tid);
      }
    }
  }
  const f = new File([lines.join('\n') + '\n'], 'split_loaded_demo.gtf', { type: 'text/plain' });
  await window.__igv.importFiles([f]);
  for (let i = 0; i < 60 && !window.__igv.S.loaded.list.length; i++) await sleep(150);
  await sleep(1500);

  const view = document.querySelector('#view');
  const ov = view.querySelector(':scope > .split-lines');
  const rows = [...view.querySelectorAll('.track')].filter((r) => !r.hidden);
  const vb = view.getBoundingClientRect();
  const rowInfo = rows.map((r) => {
    const b = r.querySelector('.track-body').getBoundingClientRect();
    return {
      name: (r.querySelector('.track-label').textContent || '').trim().replace(/\s+/g, ' ').slice(0, 16),
      loaded: r.hasAttribute('data-loaded'),
      top: +(b.top - vb.top).toFixed(0),
      h: +b.height.toFixed(0),
      panes: r.querySelectorAll('.pane').length,
    };
  });
  return {
    panels: window.__igv.S.panels.length,
    loadedTracks: window.__igv.S.loaded.list.map((t) => t.id),
    overlay: ov ? { h: ov.style.height, lines: ov.children.length,
                    xs: [...ov.children].map((c) => c.style.left) } : null,
    viewH: view.clientHeight, scrollH: view.scrollHeight,
    rows: rowInfo,
  };
})()
