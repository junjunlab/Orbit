// CDP test: 搜索栏选中候选后回填基因名 / 多基因时追加到已有列表后面。
// 前置：开发服务器 8799（在 igv_0.2 下起）、无头 Chrome 9222（cdp.js 会自动拉起）。
const { connect } = require('./cdp');

const PORT = process.env.IGV_TEST_PORT || '8799';
const URL = `http://127.0.0.1:${PORT}/?db=hg38`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  OK  ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  !!  ${name}${extra ? '  ' + extra : ''}`); }
};

async function main() {
  const cdp = await connect();
  const { send } = cdp;
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      console.error('JS ERR', JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return null;
    }
    return r.result.result.value;
  };

  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  let booted = false;
  for (let i = 0; i < 160; i++) {
    if (await ev('!!(window.__igv && window.__igv.S.asm)')) { booted = true; break; }
    await sleep(250);
  }
  if (!booted) { console.error('页面未启动'); process.exit(2); }
  await sleep(600);

  // 往搜索框里敲字并等联想列表出来
  const type = async (text) => {
    await ev(`(() => {
      const i = document.querySelector('#locus');
      i.focus(); i.value = ${JSON.stringify(text)};
      i.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    for (let i = 0; i < 40; i++) {
      const n = await ev(`document.querySelector('#suggest').hidden
        ? 0 : document.querySelector('#suggest').children.length`);
      if (n > 0) return n;
      await sleep(100);
    }
    return 0;
  };
  const names = () => ev(`[...document.querySelectorAll('#suggest .sg .n')].map((e) => e.textContent.trim())`);
  const clickName = (nm) => ev(`(() => {
    const el = [...document.querySelectorAll('#suggest .sg')]
      .find((e) => (e.querySelector('.n') || {}).textContent.trim() === ${JSON.stringify(nm)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  const value = () => ev(`document.querySelector('#locus').value`);
  const view = () => ev(`(() => { const v = window.__igv.S.view; return v.chrom + ':' + v.start + '-' + v.end; })()`);
  const setValue = (t) => ev(`(() => { const i = document.querySelector('#locus'); i.value = ${JSON.stringify(t)}; })()`);

  // ---------------------------------------------------------------- 1
  console.log('[1] 单个基因：选中后输入框变成基因名');
  const n1 = await type('jun');
  ck('联想列表出现', n1 > 0, `${n1} 条`);
  const cands1 = await names();
  ck('候选里含 JUN', cands1.includes('JUN'), cands1.slice(0, 4).join('/'));
  await clickName('JUN');
  await sleep(900);
  ck('输入框 == "JUN"', (await value()) === 'JUN', JSON.stringify(await value()));
  ck('视图已跳到 chr1', (await view()).startsWith('chr1:'), await view());

  // ---------------------------------------------------------------- 2
  console.log('\n[2] 多基因：ACTB, 后选中 JUN → 追加在后面');
  await type('ACTB,');
  await type('ACTB, jun');
  const cands2 = await names();
  ck('候选里含 JUN', cands2.includes('JUN'), cands2.slice(0, 4).join('/'));
  await clickName('JUN');
  await sleep(300);
  const v2 = await value();
  ck('输入框 == "ACTB, JUN, "', v2 === 'ACTB, JUN, ', JSON.stringify(v2));
  ck('没有被当成单基因直接跳转', (await view()).startsWith('chr1:'), await view());

  // ---------------------------------------------------------------- 3
  console.log('\n[3] 继续追加第三个基因');
  await type('ACTB, JUN, brca');
  const cands3 = await names();
  ck('候选里含 BRCA1', cands3.includes('BRCA1'), cands3.slice(0, 4).join('/'));
  await clickName('BRCA1');
  await sleep(300);
  const v3 = await value();
  ck('输入框 == "ACTB, JUN, BRCA1, "', v3 === 'ACTB, JUN, BRCA1, ', JSON.stringify(v3));

  // ---------------------------------------------------------------- 4
  console.log('\n[4] 末尾只有逗号时不残留旧候选');
  await ev(`(() => {
    const i = document.querySelector('#locus');
    i.value = 'ACTB,';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(500);
  const hidden4 = await ev(`document.querySelector('#suggest').hidden`);
  ck('联想框已隐藏（等用户敲下一个基因）', hidden4 === true, String(hidden4));

  // ---------------------------------------------------------------- 5
  console.log('\n[5] 带千分位逗号的坐标不能被当成多基因');
  const n5 = await type('chr1:1,000,000-1,001,000');
  ck('联想列表只有 1 条', n5 === 1, `${n5} 条`);
  const c5 = await names();
  ck('候选是坐标本身', c5[0] === 'chr1:1,000,000-1,001,000', JSON.stringify(c5));
  await ev(`document.querySelector('#suggest .sg').click()`);
  await sleep(700);
  const v5 = await value();
  ck('输入框 == 坐标', v5 === 'chr1:1,000,000-1,001,000', JSON.stringify(v5));
  const vw5 = await view();                       // 内部 0-based：999999 = 1,000,000
  const m5 = vw5.match(/^(chr\w+):(\d+)-(\d+)$/);
  ck('视图在 chr1:1,000,000 附近',
    !!m5 && m5[1] === 'chr1' && Math.abs(+m5[2] - 999999) < 1000, vw5);

  // ---------------------------------------------------------------- 6
  console.log('\n[6] 键盘 Enter 选中也要回填');
  await type('tp53');
  await ev(`document.querySelector('#locus').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
  await sleep(900);
  const v6 = await value();
  ck('输入框 == "TP53"', v6 === 'TP53', JSON.stringify(v6));

  // ---------------------------------------------------------------- 7
  console.log('\n[7] 多基因回车仍走分屏（不被回填逻辑破坏）');
  setValue('TP53, BRCA1');
  await ev(`document.querySelector('#locus').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
  await sleep(2200);
  const panels = await ev('window.__igv.S.panels.length');
  ck('分成 2 屏', panels === 2, String(panels));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await cdp.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
