/* 量每条轨道行里「竖线实际覆盖的高度」vs「行高」，找出空缺来自哪里 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 160 && !(window.__igv && window.__igv.S.asm); i++) await sleep(100);
  const input = document.querySelector('#locus');
  input.focus();
  input.value = 'ACTB, NCAPD2, JUND, JUNB';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  for (let i = 0; i < 80 && window.__igv.S.panels.length < 4; i++) await sleep(150);
  await sleep(1500);

  const view = document.querySelector('#view');
  const vb = view.getBoundingClientRect();
  const rows = [...view.querySelectorAll('.track')].filter((r) => !r.hidden);
  const out = [];
  let prevBottom = null;
  for (const row of rows) {
    const body = row.querySelector('.track-body');
    const label = row.querySelector('.track-label');
    const rb = row.getBoundingClientRect();
    const bb = body ? body.getBoundingClientRect() : null;
    const lb = label ? label.getBoundingClientRect() : null;
    const pane = body ? body.querySelector(':scope > .pane') : null;
    const pb = pane ? pane.getBoundingClientRect() : null;
    out.push({
      name: (label ? label.textContent : '').trim().replace(/\s+/g, ' ').slice(0, 14),
      split: body ? body.hasAttribute('data-split') : false,
      panes: body ? body.querySelectorAll(':scope > .pane').length : 0,
      rowH: +rb.height.toFixed(1),
      bodyH: bb ? +bb.height.toFixed(1) : null,
      labelH: lb ? +lb.height.toFixed(1) : null,
      paneH: pb ? +pb.height.toFixed(1) : null,
      // 行顶 → body 顶（这段没有竖线）
      gapTop: bb ? +(bb.top - rb.top).toFixed(1) : null,
      // body 底 → 行底（这段没有竖线，通常就是 label 比 canvas 高的那部分）
      gapBottom: bb ? +(rb.bottom - bb.bottom).toFixed(1) : null,
      // 和上一行之间的空隙（行间距 + border）
      gapPrev: prevBottom === null ? null : +(rb.top - prevBottom).toFixed(1),
      borderLeft: pane ? getComputedStyle(pane).borderLeftWidth + ' ' + getComputedStyle(pane).borderLeftColor : null,
    });
    prevBottom = rb.bottom;
  }
  return {
    panels: window.__igv.S.panels.length,
    viewH: +vb.height.toFixed(1),
    viewScrollH: view.scrollHeight,
    rows: out,
  };
})()
