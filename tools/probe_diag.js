(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(4000);
  return {
    hasIgv: typeof window.__igv,
    hasVEX: typeof window.VEX,
    scripts: [...document.querySelectorAll('script')].map((s) => s.getAttribute('src')),
    title: document.title,
    bodyLen: document.body.innerText.length,
    err: window.__err || null,
  };
})()
