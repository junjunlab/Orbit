/* 截图用：模拟「ACTB, jun → 选中 JUN」，停在 ACTB, JUN, 的输入状态 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !(window.__igv && window.__igv.S.asm); i++) await sleep(100);
  const input = document.querySelector('#locus');
  const box = document.querySelector('#suggest');
  input.focus();
  input.value = 'ACTB, jun';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  for (let i = 0; i < 40 && box.hidden; i++) await sleep(100);
  await sleep(200);
  const el = [...box.querySelectorAll('.sg')].find(
    (e) => e.querySelector('.n').textContent.trim() === 'JUN');
  if (el) el.click();
  await sleep(400);
  input.focus();
  return { value: input.value };
})()
