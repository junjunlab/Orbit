// 共用 CDP 连接器：
//   - 已经有 Chrome 在 --remote-debugging-port=9222 → 直接复用它
//   - 没有 → 自己拉一个无头实例，profile 放在系统临时目录，脚本结束时关掉
//     （项目根目录不会再出现 .chrome-* 临时目录）
//
//   const { connect } = require('./cdp');
//   const cdp = await connect();
//   await cdp.send('Page.navigate', { url });
//   ...
//   await cdp.close();
//
// 环境变量：
//   IGV_DPR=1.5          设备像素比，默认 1.5（像素级接缝问题只有 >1 才复现）
//   IGV_KEEP_PROFILE=1   复用上一次的临时 profile（默认每次清空，避免 localStorage 污染回归）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PROFILE = path.join(os.tmpdir(), 'igv-cdp-profile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';
  const cands = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return cands.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
}

async function listPage() {
  try {
    const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
    return list.find((t) => t.type === 'page') || null;
  } catch {
    return null;
  }
}

async function connect(opts = {}) {
  const dpr = opts.dpr || process.env.IGV_DPR || '1.5';
  const clean = opts.clean !== undefined ? opts.clean : process.env.IGV_KEEP_PROFILE !== '1';

  let target = null;
  for (let i = 0; i < 16 && !target; i++) {
    target = await listPage();
    if (!target) await sleep(250);
  }

  let child = null;
  if (!target) {
    const exe = findChrome();
    if (!exe) throw new Error('no Chrome listening on 9222, and no chrome.exe found');
    if (clean) {
      try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    child = spawn(exe, [
      '--headless=new',
      '--remote-debugging-port=9222',
      `--user-data-dir=${PROFILE}`,
      '--window-size=1600,900',
      `--force-device-scale-factor=${dpr}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-proxy-server',
      '--proxy-bypass-list=*',
      'about:blank',
    ], { stdio: 'ignore', detached: false });
    console.log(`launched chrome (dpr=${dpr}, profile=${PROFILE})`);
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(250);
      target = await listPage();
    }
  }
  if (!target) {
    if (child) child.kill();
    throw new Error('no page target');
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const send = (method, params) => new Promise((res) => {
    const mid = ++id;
    waiting.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  const close = async () => {
    try { ws.close(); } catch { /* ignore */ }
    if (child) {
      child.kill();
      await sleep(300);
    }
  };

  return { send, close, launched: Boolean(child) };
}

module.exports = { connect, PROFILE };
