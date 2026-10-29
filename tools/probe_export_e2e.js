/* 端到端：劫持 <a> 点击，跑三种导出，回报文件名 / MIME / 字节数 + SVG 头尾 */
(async () => {
  const ig = window.__igv;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !(ig.S.data.genes && ig.S.data.genes.length); i++) await sleep(100);
  if (ig.S.panels.length < 2) { ig.setPanelCount(2); await sleep(1000); }
  await sleep(300);

  const got = [];
  const realClick = HTMLAnchorElement.prototype.click;
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = (blob) => { got.push({ blob }); return realCreate.call(URL, blob); };
  HTMLAnchorElement.prototype.click = function () {
    const rec = got[got.length - 1];
    const blob = rec ? rec.blob : null;
    rec.name = this.download || '';
    rec.size = blob ? blob.size : -1;
    rec.type = blob ? blob.type : '';
    rec.tail = null;
  };

  let svgHead = '', svgTail = '';
  try {
    if (got.length >= 3) {
      const { blob } = got[2];
      const txt = await blob.text();
      svgHead = txt.slice(0, 220);
      svgTail = txt.slice(-80);
    }
  } catch { /* ignore */ }

  try {
    await ig.doExport('png');
    await ig.doExport('svg');
    await ig.doExport('pdf');
  } finally {
    HTMLAnchorElement.prototype.click = realClick;
    URL.createObjectURL = realCreate;
  }

  const svg = got[1] ? await got[1].blob.text() : '';
  return {
    files: got.map((g) => ({ name: g.name, type: g.type, size: g.size })),
    svgHead: svg.slice(0, 200).replace(/\n/g, '\\n'),
    svgTail: svg.slice(-60).replace(/\n/g, '\\n'),
    svgHasImage: svg.includes('<image') && svg.includes('base64,'),
    toast: document.querySelector('#toast') ? document.querySelector('#toast').textContent : '',
  };
})()
