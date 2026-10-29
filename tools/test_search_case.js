// 端到端验证：搜索下拉框的基因名大小写
// 期望：mm10 显示 MGI 惯例的混合大小写（Actr1b），hg38 显示 HGNC 惯例的全大写（TP53）
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = [];
  const log = (s) => { out.push(s); console.log(s); };

  const $ = (s) => document.querySelector(s);

  // 等 DOM 与应用就绪
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    if ($('#locus') && document.querySelectorAll('#asmMenu .asm-item').length) break;
  }
  if (!$('#locus')) { log('FAIL 页面未就绪：#locus 不存在'); return out.join('\n'); }
  log('页面就绪，当前装配: ' + ($('#asmName') || {}).textContent);

  async function switchTo(id) {
    const item = document.querySelector(`#asmMenu .asm-item[data-id="${id}"]`);
    if (!item) { log(`FAIL 找不到装配项 ${id}`); return false; }
    item.click();
    // 等装配切换完成（asmName 文本更新 + 数据加载）
    for (let i = 0; i < 60; i++) {
      await sleep(150);
      if ($('#asmName').textContent.includes(id)) break;
    }
    await sleep(600);
    return true;
  }

  async function typeSearch(q) {
    const inp = $('#locus');
    inp.focus();
    inp.value = q;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    // 等联想框出结果
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      const box = $('#suggest');
      if (box && !box.hidden && box.querySelectorAll('.sg').length) break;
    }
    await sleep(250);
    return [...document.querySelectorAll('#suggest .sg')].map(el => {
      const n = el.querySelector('.n');
      const k = el.querySelector('.k');
      return { kind: k ? k.textContent.trim() : '', name: n ? n.textContent.trim() : '' };
    });
  }

  function check(label, rows, expectMixed) {
    const genes = rows.filter(r => r.kind === '基因');
    if (!genes.length) { log(`FAIL ${label}: 没有基因命中`); return; }
    const upperCount = genes.filter(g => g.name === g.name.toUpperCase()).length;
    const sample = genes.slice(0, 6).map(g => g.name).join(', ');
    log(`   ${label} 命中 ${genes.length} 条，前几条: ${sample}`);
    if (expectMixed) {
      // 小鼠：应当绝大多数不是全大写
      if (upperCount > Math.ceil(genes.length * 0.15)) {
        log(`FAIL ${label}: 仍以全大写为主 (${upperCount}/${genes.length})`);
      } else {
        log(`PASS ${label}: 混合大小写已生效（全大写仅 ${upperCount}/${genes.length}）`);
      }
    } else {
      if (upperCount < genes.length * 0.8) {
        log(`FAIL ${label}: 人类基因应全大写，实际 ${upperCount}/${genes.length}`);
      } else {
        log(`PASS ${label}: 人类全大写保持不变 (${upperCount}/${genes.length})`);
      }
    }
  }

  // ---- 1. 小鼠 mm10
  log('== 切换到 Mouse mm10 ==');
  if (!await switchTo('mm10')) { log('FAIL 切换 mm10 失败'); }
  let rows = await typeSearch('AC');
  check('mm10 搜 "AC"', rows, true);

  // 小鼠精确匹配一个经典基因
  rows = await typeSearch('trp53');
  const t = rows.find(r => r.kind === '基因' && /trp53/i.test(r.name));
  log(`   精确搜 trp53 -> ${t ? t.name : '(无)'}`);
  log(t && t.name === 'Trp53' ? 'PASS 小鼠 Trp53 大小写正确' : `FAIL 小鼠 Trp53 显示为 ${t ? t.name : 'null'}`);

  // ---- 2. 人类 hg38
  log('== 切换到 Human hg38 ==');
  if (!await switchTo('hg38')) { log('FAIL 切换 hg38 失败'); }
  rows = await typeSearch('TP53');
  const h = rows.find(r => r.kind === '基因' && /tp53/i.test(r.name));
  log(`   精确搜 TP53 -> ${h ? h.name : '(无)'}`);
  log(h && h.name === 'TP53' ? 'PASS 人类 TP53 全大写保持' : `FAIL 人类 TP53 显示为 ${h ? h.name : 'null'}`);

  // ---- 3. 大小写不敏感：小写输入也应命中
  log('== 切回 mm10，测试大小写不敏感 ==');
  await switchTo('mm10');
  rows = await typeSearch('acadl');
  const a = rows.find(r => r.kind === '基因');
  log(`   搜 acadl -> ${a ? a.name : '(无)'}`);
  log(a && a.name === 'Acadl' ? 'PASS 小写输入 acadl 命中 Acadl' : `FAIL acadl 命中为 ${a ? a.name : 'null'}`);

  window.__case_result = out.join('\n');
  return out.join('\n');
})();
