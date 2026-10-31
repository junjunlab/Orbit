// Drive the page over CDP: run JS, then capture a screenshot.
//   node tools/cdp_shot.js <url> <out.png> [jsFile]
//
// 有现成的 Chrome（--remote-debugging-port=9222）就直接连；没有就自己拉一个无头实例
// （profile 在系统临时目录，脚本结束自动关），见 tools/cdp.js。
//
// 环境变量：IGV_DPR（默认 1.5）、IGV_KEEP_PROFILE=1（复用临时 profile）
const fs = require('fs');
const { connect } = require('./cdp');

const url = process.argv[2];
const out = process.argv[3];
const jsFile = process.argv[4];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cdp = await connect();
  try {
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url });
    await sleep(3500);

    if (jsFile) {
      const expr = fs.readFileSync(jsFile, 'utf8');
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) {
        console.error('JS error:', JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      } else if (r.result && r.result.result) {
        const val = r.result.result.value;
        // IGV_DUMP_B64=out.png → 把脚本返回的 base64（dataURL 或纯 base64）写盘，便于检查页面内生成的图片
        if (process.env.IGV_DUMP_B64 && typeof val === 'string') {
          const b64 = val.replace(/^data:[^,]*,/, '');
          fs.writeFileSync(process.env.IGV_DUMP_B64, Buffer.from(b64, 'base64'));
          console.log('dumped', process.env.IGV_DUMP_B64, `${Buffer.from(b64, 'base64').length} bytes`);
        } else {
          console.log('JS ->', JSON.stringify(val));
        }
      }
      await sleep(1200);
    }

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('wrote', out);
  } finally {
    await cdp.close();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
