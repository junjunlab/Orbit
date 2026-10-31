const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = async (e) => {
    const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8799/?db=hg38&locus=chr1:58,776,673-58,785,704' });
  for (let i = 0; i < 150 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(4000);
  // 打开基因组菜单，看第一项
  console.log('菜单首项:', await ev(`(() => { const m=document.getElementById('asmMenu'); m.classList.add('open'); const f=m.querySelector('.asm-item'); return f ? f.textContent.replace(/\\s+/g,' ').trim().slice(0,60) : 'none'; })()`));
  await ev(`(() => { document.querySelector('#asmMenu .asm-item').click(); })()`);
  await sleep(2500);
  console.log('切换后:', JSON.stringify(await ev(`(() => { const S=window.__igv.S; return { custom: !!S.asm.custom, id: S.asm.id, chroms: Object.keys(S.asm.chroms||{}).length, view: S.view.chrom, label: document.getElementById('asmName').textContent }; })()`)));
  // 用路径挂载 BAM，看坐标轴是否自动建立
  const path = 'C:////Users////JunJun////Desktop////SRR22507537Aligned.sortedByCoord.out.bam';
  const r = await ev(`(async () => { const res = await fetch('api/load_local?db=' + encodeURIComponent(window.__igv.S.asm.id) + '&path=' + encodeURIComponent('${path.replace(/\\\\/g,'\\\\\\\\')}'), {method:'POST'}); return await res.text(); })()`);
  console.log('挂载返回:', String(r).slice(0, 120));
  await sleep(4000);
  await ev(`window.__igv.loadBwTracks().then(()=>window.__igv.ensureAll(true))`);
  await sleep(3000);
  console.log('挂载后:', JSON.stringify(await ev(`(() => { const S=window.__igv.S; return { chroms: Object.keys(S.asm.chroms||{}).length, first: Object.keys(S.asm.chroms||{})[0], view: S.view.chrom + ':' + S.view.start + '-' + S.view.end }; })()`)));
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
