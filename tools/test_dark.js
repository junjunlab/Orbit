(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let tries = 0;
  while (tries++ < 60) {
    if (document.querySelectorAll('.track[data-bw] canvas').length >= 1) break;
    await wait(200);
  }
  document.getElementById('btnTheme').click();
  await wait(400);
  return JSON.stringify({ theme: document.body.dataset.theme });
})();
