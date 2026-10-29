/* 端到端：跑 doExport(png/svg/pdf)，记录文件名、MIME、字节数 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  const got = [];
  const realClick = HTMLAnchorElement.prototype.click;
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = (blob) => { got.push({ blob, name: '' }); return realCreate.call(URL, blob); };
  HTMLAnchorElement.prototype.click = function () { got[got.length - 1].name = this.download || ''; };
  try {
    for (const k of ['png', 'svg', 'pdf']) { await ig.doExport(k); await sleep(500); }
  } finally {
    HTMLAnchorElement.prototype.click = realClick;
    URL.createObjectURL = realCreate;
  }
  const files = [];
  for (const g of got) {
    const head = new Uint8Array(await g.blob.slice(0, 8).arrayBuffer());
    files.push({ name: g.name, type: g.blob.type, size: g.blob.size, head: String.fromCharCode(...head).replace(/[^\x20-\x7e]/g, '.') });
  }
  return { files, toast: (document.querySelector('#toast') || {}).textContent };
})()
