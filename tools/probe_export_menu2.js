/* 打开导出菜单截图 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 60 && !document.querySelector('#btnExport'); i++) await sleep(100);
  await sleep(800);
  document.querySelector('#btnExport').click();
  await sleep(400);
  const m = document.querySelector('#expMenu');
  const r = m.getBoundingClientRect();
  return { open: !m.hidden, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], text: m.textContent.replace(/\s+/g, ' ').slice(0, 120) };
})()
