'use strict';
// Isolated headless browser: unique temporary profile, random debug port.
// Does not attach to or stop an existing user browser.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

async function main() {
  const url = process.argv[2];
  const output = process.argv[3];
  assert.ok(url && output, 'Usage: node test_bam_browser.js <isolated URL> <screenshot.png>');
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  const exe = process.env.ORBIT_TEST_BROWSER || candidates.find(p => fs.existsSync(p));
  assert.ok(exe, 'No headless Chrome/Edge found');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-bam-browser-'));
  const child = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--window-size=1600,1000', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let ws;
  const timeout = setTimeout(() => { child.kill(); throw new Error('Browser validation timed out'); }, 120000);
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let text = '';
      child.stderr.on('data', chunk => {
        text += chunk.toString();
        const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) resolve(match[1]);
      });
      child.on('error', reject);
      child.on('exit', code => reject(new Error('Browser exited ' + code + ': ' + text)));
    });
    ws = new WebSocket(endpoint);
    const pending = new Map(); let id = 0;
    ws.addEventListener('message', event => {
      const reply = JSON.parse(event.data);
      if (pending.has(reply.id)) {
        const { resolve, reject } = pending.get(reply.id); pending.delete(reply.id);
        reply.error ? reject(new Error(JSON.stringify(reply.error))) : resolve(reply.result);
      }
    });
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
    function send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) })); });
    }
    const target = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const page = (method, params = {}) => send(method, params, sessionId);
    await page('Page.enable');
    await page('Runtime.enable');
    const evalJS = async expression => {
      const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await page('Page.navigate', { url });
    await evalJS(`new Promise((resolve, reject) => {
      const deadline = performance.now() + 45000;
      function check() {
        if (window.__igv && window.__igv.S.bw.list.length) return resolve(true);
        if (performance.now() > deadline) return reject(new Error('Orbit did not finish booting'));
        requestAnimationFrame(check);
      }
      check();
    })`);
    const first = await evalJS(`(async () => {
      const x = window.__igv;
      await x.ensureAll(true);
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      x.render();
      const P = x.S.panels[0], t = x.S.bw.list[0];
      const data = P.alignData[t.id];
      return { id: t.id, reads: data?.reads?.length, total: data?.total, sampled: data?.sampled,
        coverage: P.bwData[t.id]?.values?.filter(Boolean).length,
        rows: [...document.querySelectorAll('.track[data-bw],.track[data-junc],.track[data-align]')].map(e => ({ key: Object.keys(e.dataset).find(k => ['bw','junc','align'].includes(k)), hidden: e.hidden, height: e.getBoundingClientRect().height, text: e.querySelector('.sub')?.textContent })),
        pending: x.S.pending, experimentType: t.experimentType };
    })()`);
    assert.equal(first.reads, first.total); assert.ok(first.reads > 200); assert.equal(first.sampled, false);
    assert.ok(first.coverage > 0); assert.equal(first.rows.filter(r => r.key === 'junc').length, 1);
    assert.deepEqual(first.rows.map(r => r.key), ['bw', 'junc', 'align']);
    assert.ok(first.rows.every(r => !r.hidden));
    const switchResult = await evalJS(`(async () => {
      const x = window.__igv, t = x.S.bw.list[0];
      await x.navigate('II', 0, 700000); await x.ensureAll(true);
      const wide = { align: x.S.panels[0].alignData[t.id]?.tooWide, cov: x.S.panels[0].bwData[t.id]?.tooWide };
      await x.navigate('I', 40000, 45000); await x.ensureAll(true);
      await new Promise(requestAnimationFrame); x.render();
      const d = x.S.panels[0].alignData[t.id];
      return { wide, narrowReads: d?.reads?.length, narrowTotal: d?.total, pending: x.S.pending };
    })()`);
    assert.equal(switchResult.wide.align, true); assert.equal(switchResult.wide.cov, true);
    assert.equal(switchResult.narrowReads, first.reads); assert.equal(switchResult.pending, 0);
    const shot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(output, Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify({ PASS: true, initial: first, switchResult, screenshot: output }, null, 2));
    await send('Target.closeTarget', { targetId: target.targetId });
  } finally {
    clearTimeout(timeout);
    if (ws) ws.close();
    child.kill();
    // Leave the private temporary profile for OS cleanup; no recursive deletion.
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
