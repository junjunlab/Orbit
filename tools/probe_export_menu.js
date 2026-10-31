/* 打开导出菜单，检查选项与勾选框 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  if (ig.S.panels.length < 2) { ig.setPanelCount(2); await sleep(1000); }
  document.querySelector('#btnExport').click();
  await sleep(250);
  const menu = document.querySelector('#expMenu');
  const items = [...menu.querySelectorAll('.sm-item')].map((b) => b.textContent.replace(/\s+/g, ' ').trim());
  const cb = menu.querySelector('input[type="checkbox"]');
  return { open: !menu.hidden, items, checked: cb ? cb.checked : null,
    hint: (menu.querySelector('.sm-hint') || {}).textContent };
})()
