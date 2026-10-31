const fs = require('fs');
const { connect } = require('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.3/tools/cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const cdp = await connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 300, deviceScaleFactor: 2, mobile: false });
  const ev = async (e) => {
    const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8799/?lang=en&cb=' + Date.now() });
  for (let i = 0; i < 150 && !(await ev('!!window.__igv')); i++) await sleep(150);
  await sleep(3000);
  console.log('按钮:', await ev(`(() => { const b=document.getElementById('btnLocal'); const r=b.getBoundingClientRect(); return b.textContent.trim() + ' w=' + Math.round(r.width) + ' svg=' + (b.querySelector('svg').getBoundingClientRect().width); })()`));
  const s = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 120, scale: 2 } });
  fs.writeFileSync('C:/Users/JunJun/Desktop/agent_devop_pkgs/igv/igv_0.4/tools/_nav_local.png', Buffer.from(s.result.data, 'base64'));
  cdp.close();
})().catch((e) => { console.error(e); process.exit(1); });
