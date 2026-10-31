/* Orbit - canvas genome browser front-end (no dependencies) */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // 界面文案：中文原文 → 当前语言（见 i18n.js）
  const T = (s) => window.I18N.t(s);

  const api = async (path, params, opts) => {
    const qs = new URLSearchParams(params || {}).toString();
    const init = (opts && opts.signal) ? { signal: opts.signal } : undefined;
    const res = await fetch(`api/${path}${qs ? '?' + qs : ''}`, init);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  };

  const fmt = (n) => n.toLocaleString('en-US');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // 模块级的 HTML 转义（染色体名 / 文件名里可能有 & < 等字符）
  const escAttr = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // a well known gene to land on when an assembly is opened
  const LANDMARKS = {
    hg38: 'TP53', hg19: 'TP53', mm39: 'Trp53', mm10: 'Trp53',
  };

  /* ------------------------------------------------------------------ state */
  const S = {
    assemblies: [],
    asm: null,
    // view / data / bw.data 都通过存取器指向「当前活动面板」（多位置分屏）
    panels: [],
    act: 0,      // 操作目标（搜索/缩放/全染色体作用在哪一屏），始终有效
    selPane: 0,  // 视觉选中的那一屏；-1 = 没有选中（灰底与顶部强调线都消失），再点一次即取消
    sel: null,
    selTrack: null, // set when S.sel comes from an imported (loaded) track
    expanded: new Set(), // gene keys (name|chrom) shown as expanded transcripts
    hover: null,
    // 默认只看注释：gc / seq 都要读 2bit 序列，默认关（需要时手动勾）。
    // 这样纯注释包（不带 genomes/*.2bit，约 60 MB）开箱就是可用状态，
    // 不会一打开就请求序列、显示「未内置」。
    tracks: { ideogram: true, ruler: true, genes: true, gc: false, seq: false, overview: true },
    overviewExpanded: false,   // 全基因组总览默认折叠为单行条带（见 drawOverview），仅会话内有效
    bw: {
      list: [], on: {}, data: {}, colors: {},
      cfg: {},      // track id -> {color, mode:'auto'|'fixed', min, max, group}
      groups: [],   // [{id, name, shared}]  shared = 组内共用纵轴
      sel: new Set(), // multi-selection of track ids for batch ops
      hidden: new Set(), // bundled track ids the user removed (persisted, restorable)
      // 导入轨道的勾选状态（存 localStorage）。内置轨道不记，仍按「前 6 条默认开」；
      // 导入轨道记住上次的开关，否则重开软件时热图 / 信号轨道全是关的，像没导入成功。
      onSaved: {},
    },
    loaded: { list: [], on: {}, data: {}, _pending: {}, expanded: new Set(), tint: {}, sel: new Set(),
      expandAll: new Set(),   // 一键展开：轨道 id 集合
      collapsed: new Set(),   // 一键展开模式下被单独收起的基因
      pack: new Set(),        // 「分行排布」的导入基因轨道（默认折叠为一行，见 geneCollapsed）
      flip: new Set() },      // 导入序列轨道里「显示互补链」的轨道 id（同 RefSeq 的 Flip strand）
    // Find motif（对应 IGV 的 Tools → Find Motif）：会话内有效，不落盘
    motif: { list: [], cache: {}, inflight: {}, seq: 0, lastPattern: '', nameTouched: false },
    // null = 跟随主题；genes/CDS/UTR 同时作用于 RefSeq 与导入的 GTF 轨道
    tint: { genesPlus: null, genesMinus: null, cds: null, utr: null, gc: null },
    theme: 'light',
    labelW: 116,    // 轨道标签列宽度（可拖动，存 localStorage）
    trackOrder: [], // 轨道行顺序（键名，存 localStorage；见 trackKey）
    // 序列轨道是否显示互补链（同 IGV 序列轨道的 Flip strand，存 localStorage）
    seqFlip: false,
    // 氨基酸翻译（对应 IGV 序列轨道的 Show translation + Translation Table）
    // 开关**按轨道独立**：内置序列轨道用 on，导入序列轨道用 loaded 集合。
    // table 是全局默认表；loadedTable 让每条导入轨道可以各自选表（缺省跟随 table）。
    trans: { on: false, table: 1, loaded: new Set(), loadedTable: {} },
    // 「一键展开所有基因的转录本」：开启后默认全展开，单独收起的记在 collapsed 里，
    // 这样平移/缩放之后新出现的基因也保持展开（比「把当前可见基因挨个加进 expanded」好用）
    expandAll: false,
    collapsed: new Set(),
    // 基因轨道默认「折叠为一行」（同 IGV 的 collapsed 模式）：所有基因画在同一行，
    // 重叠就重叠。关掉后回到「分行排布」（重叠的基因逐行往上叠）。
    geneCollapsed: true,
    // 全基因组视图（染色体下拉里选「全部染色体」）：会话内有效，不落盘
    genomeView: false,
    genomeData: null,   // 当前装配的基因密度（/api/genome 结果，按装配缓存）
    pending: 0,
    dpr: window.devicePixelRatio || 1,
  };

  const EMPTY_VIEW = { chrom: null, start: 0, end: 0 };

  function makePanel(view) {
    return {
      view: view ? { ...view } : { ...EMPTY_VIEW },
      data: { range: { start: 0, end: 0 }, genes: [], gc: null, gcRange: null,
        seq: null, seqStart: 0, loadedFor: null, truncated: false },
      bwData: {},   // 该面板的信号轨道缓存（key = track id）
      alignData: {}, // BAM 比对视图缓存（key = track id）
      toggles: [],  // RefSeq 展开按钮命中区
      ltoggles: [], // 导入 GTF 展开按钮命中区
    };
  }
  S.panels.push(makePanel(null));

  Object.defineProperty(S, 'view', {
    get() { return S.panels[S.act].view; },
    set(v) { S.panels[S.act].view = v; },
    configurable: true,
  });
  Object.defineProperty(S, 'data', {
    get() { return S.panels[S.act].data; },
    set(v) { S.panels[S.act].data = v; },
    configurable: true,
  });
  Object.defineProperty(S.bw, 'data', {
    get() { return S.panels[S.act].bwData; },
    set(v) { S.panels[S.act].bwData = v; },
    configurable: true,
  });
  Object.defineProperty(S, '_geneToggles', {
    get() { return S.panels[S.act].toggles; },
    set(v) { S.panels[S.act].toggles = v; },
    configurable: true,
  });
  Object.defineProperty(S, '_loadedToggles', {
    get() { return S.panels[S.act].ltoggles; },
    set(v) { S.panels[S.act].ltoggles = v; },
    configurable: true,
  });

  const C = {}; // theme colours, refreshed on theme change

  function readColors() {
    const cs = getComputedStyle(document.body);
    const v = (n) => cs.getPropertyValue(n).trim();
    Object.assign(C, {
      text: v('--text'),
      dim: v('--text-dim'),
      muted: v('--muted'),
      grid: v('--grid'),
      border: v('--border'),
      plus: v('--plus'),
      minus: v('--minus'),
      cds: v('--gene-cds'),
      utr: v('--gene-utr'),
      bg: v('--canvas-bg'),
      panel: v('--panel') || v('--canvas-bg'),
      borderSoft: v('--border-soft') || v('--border'),
      paneLine: v('--pane-line') || '#000',
      viewLine: v('--view-line') || '#d81e2b',
      motifPos: v('--motif-pos') || '#1f6fb2',
      motifNeg: v('--motif-neg') || '#c0392b',
      cnvGain: v('--cnv-gain') || '#c0392b',
      cnvLoss: v('--cnv-loss') || '#2a6fb0',
      accent: v('--accent'),
      read: v('--read') || '#c9c9c9',
      readEdge: v('--read-edge') || '#b0b0b0',
    });
  }

  /* ------------------------------------------------------------------- boot */
  // 这次加载是「刷新」还是「新打开」？只有刷新才恢复上次的分屏布局。
  // 浏览器重新打开程序时是一次普通导航（type === 'navigate'），刷新才是 'reload'。
  function isPageReload() {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav && nav.type) return nav.type === 'reload';
      // 老浏览器兜底
      return performance.navigation && performance.navigation.type === 1;
    } catch {
      return false;
    }
  }

  async function boot() {
    readColors();
    applyTheme(S.theme);
    resetStoredPrefs();  // 每次启动都从零开始（见 FRESH_EACH_LAUNCH）
    loadPrefs();
    applyLabelW(S.labelW);
    bindUI();
    applyTrackOrder();   // 恢复上次拖出来的行顺序（此时静态轨道已在 DOM 里）
    try {
      const cat = await api('catalog');
      S.assemblies = cat.assemblies || [];
    } catch (err) {
      toast(T('无法连接本地服务：') + err.message);
      return;
    }
    if (!S.assemblies.length) {
      toast(T('data/catalog.json 为空，请先运行构建脚本'));
      return;
    }
    renderAsmMenu();
    // fresh: 启动时不把上次导入的轨道自动挂出来（左侧仍可勾选，文件不会丢）
    loadBwTracks({ fresh: true });
    loadLoadedTracks({ fresh: true });
    const params = new URLSearchParams(location.search);
    const wantDb = params.get('db');
    // 默认进「自定义（空）」：主场景是用户自带的 FASTA / GTF / BAM，
    // 需要内置物种时从下拉里选，或者带 ?db=hg38。
    const chosen = (wantDb && S.assemblies.find((a) => a.id === wantDb)) || CUSTOM_ASM;
    await selectAssembly(chosen.id, true);

    const locus = params.get('locus');
    if (locus) {
      const loc = parseLocus(locus, chosen.chroms);
      if (loc) await navigate(loc.chrom, loc.start, loc.end);
    }

    // 多位置：?loci=chr1:1-2,chr3:3-4 → 直接分屏。
    // 上次的分屏布局只在「刷新」时恢复：重新打开程序应该是单屏，
    // 否则用户会觉得「怎么默认打开就是分屏」。
    const lociParam = params.get('loci');
    if (lociParam) {
      const list = lociParam.split(/[,;]/).map((t) => parseLocus(t.trim(), chosen.chroms)).filter(Boolean);
      if (list.length > 1) await restoreSplit(list);
    } else if (isPageReload()) {
      await restoreSplit();
    }

    // debug hook for automated testing (harmless in normal use)
    window.__igv = { S, geneLayout, geneAt, expandHit, txIndexAt, toggleExpand, geneKey, isExpanded, navigate, scheduleRender, renderInfo, importFiles, loadLoadedTracks, loadBwTracks,
      loadedGeneAt, loadedToggleHit, loadedGeneKey, isLoadedExpanded, toggleLoadedExpand, withViewChrom,
      expandAllOn, setExpandAll,
      geneTint, setGeneTint, openTrackPop, renderPopGenes, loadedColors: geneTint,
      setPanelCount, closePanel, goPanel, navigatePanel, restoreSplit, syncPanes, syncSplitLines,
      applyLabelW,
      openMotifDialog, closeMotifDialog, submitMotif, addMotifTrack, ensureMotifTrackEls,
      removeMotifTrack, drawMotifs, motifMode, refreshMotifLabels,
      setSeqFlip, complementBase, loadedSeqFlipped, setLoadedSeqFlip,
      setSeqTrans, setTransTable, setLoadedTrans, transOnFor, transTableFor,
      geneticCode, GENETIC_TABLES, openTransPop, closeTransPop,
      hexLum, inkOn, drawSeq, render,
      setActivePanel, ensureAll, togglePane, composePlot, plotRows, doExport, exportName,
      composeVector, loadCJKFont, pdfFromCanvas,
      pickChrom, enterGenomeView, exitGenomeView,
      panels: () => S.panels };
  }

  /* -------------------------------------------------------------- assemblies */
  // 「自定义（空）」装配：不预置任何染色体/注释，用户导入自己的 FASTA / GTF / BAM
  // 之后坐标轴由导入文件自己撑起来（染色体字典从后端 track_chroms 取）。
  const CUSTOM_ASM = {
    id: '__custom__', organism: T('自定义'), scientificName: '', description: T('空 · 用自己导入的 FASTA / GTF'),
    chroms: {}, hasSeq: false, hasGenes: false, geneCount: 0, custom: true,
  };

  function renderAsmMenu() {
    const menu = $('#asmMenu');
    menu.innerHTML = '';
    // 置顶一个空装配，方便用自备文件
    {
      const el = document.createElement('div');
      el.className = 'asm-item' + (S.asm && S.asm.custom ? ' active' : '');
      el.dataset.id = CUSTOM_ASM.id;
      el.innerHTML = T(`
        <div class="t">${CUSTOM_ASM.organism}<small>${T('空')}</small></div>
        <div class="d">${CUSTOM_ASM.description}</div>
        <div class="tags">
          <span class="tag no">${T('无内置序列')}</span>
          <span class="tag no">${T('无内置注释')}</span>
        </div>`);
      el.onclick = () => { menu.classList.remove('open'); selectAssembly(CUSTOM_ASM.id); };
      menu.appendChild(el);
    }
    for (const a of S.assemblies) {
      const el = document.createElement('div');
      el.className = 'asm-item' + (S.asm && a.id === S.asm.id ? ' active' : '');
      el.dataset.id = a.id;
      el.innerHTML = T(`
        <div class="t">${a.organism}<small>${a.id}</small></div>
        <div class="d">${a.scientificName || ''} · ${a.description || ''}</div>
        <div class="tags">
          <span class="tag ${a.hasSeq ? 'ok' : 'no'}">${a.hasSeq ? (a.seqRemote ? T('序列·联网') : T('序列已内置')) : T('仅注释')}</span>
          <span class="tag ${a.hasGenes ? 'ok' : 'no'}">${a.geneCount ? fmt(a.geneCount) + T(' 基因') : T('无注释')}</span>
        </div>`);
      el.onclick = () => { menu.classList.remove('open'); selectAssembly(a.id); };
      menu.appendChild(el);
    }
  }

  const bandsCache = {};

  // 当前装配没有内置序列时，GC / 序列两个轨道取不到任何数据（后端返回
  // {"gc": null, "reason": "no sequence bundled"}）。与其让用户勾上后看到
  // 「该版本未内置序列文件」以为坏了，不如直接把复选框禁用。
  // 纯注释包（不带 genomes/*.2bit）打开时就是这种状态。
  function syncSeqTrackAvailability() {
    const has = !!(S.asm && S.asm.hasSeq);
    for (const name of ['gc', 'seq']) {
      const cb = $(`input[data-track="${name}"]`);
      if (!cb) continue;
      cb.disabled = !has;
      const lab = cb.closest('label');
      if (lab) {
        lab.classList.toggle('na', !has);
        lab.title = has ? '' : T('此装配未内置序列（data/genomes 里没有对应 .2bit）');
      }
      if (!has) { S.tracks[name] = false; cb.checked = false; }
    }
  }

  // 自定义装配：从已导入的轨道里收集染色体字典（后端 track_chroms），
  // 用户拖进来的 BAM / bigWig / GTF 自己就能把坐标轴撑起来。
  let customChromsBusy = false;
  async function refreshCustomChroms() {
    if (!S.asm || !S.asm.custom || customChromsBusy) return;
    customChromsBusy = true;
    try {
      const ids = [...(S.bw.list || []).map((t) => t.id), ...(S.loaded.list || []).map((t) => t.id)];
      const merged = {};
      for (const id of ids) {
        try {
          const r = await api('track_chroms', { track: id });
          let got = 0;
          for (const [c, len] of Object.entries(r.chroms || {})) {
            if (!(len > 0)) continue;
            merged[c] = Math.max(merged[c] || 0, len);
            got++;
          }
          if (got) break;          // 有一条能提供字典就够了
        } catch { /* 单条失败继续试下一条 */ }
      }
      if (!Object.keys(merged).length) return;
      S.asm.chroms = merged;
      renderChromMenu();
      if (!S.view.chrom) {
        const best = Object.entries(merged).sort((a, b) => b[1] - a[1])[0];
        await navigate(best[0], 0, best[1]);
      } else {
        scheduleRender();
      }
      updateStatus();
    } finally {
      customChromsBusy = false;
    }
  }

  async function selectAssembly(id, first) {
    const a = id === CUSTOM_ASM.id ? CUSTOM_ASM : S.assemblies.find((x) => x.id === id);
    if (!a) return;
    S.asm = a;
    $('#asmName').textContent = a.custom ? T('自定义（空）') : `${a.organism} ${a.id}`;
    $('#asmDot').className = 'dot' + (a.hasSeq ? '' : ' warn');
    syncSeqTrackAvailability();
    $('#stAsm').textContent = `${a.scientificName || a.organism} · ${a.description || ''}`;
    renderAsmMenu();
    renderChromMenu();
    closeTrackPop();
    if (S.bw.list.length) { renderBwList(); ensureBwTrackEls(); }

    if (a.custom) {
      S.bands = {};
      S.view = { chrom: '', start: 0, end: 0 };
      S.genomeView = false;
      renderChromMenu();
      refreshCustomChroms();
      scheduleRender();
      updateStatus();
      return;
    }
    if (!bandsCache[id]) {
      try {
        const r = await api('cytobands', { db: id });
        bandsCache[id] = r.bands || {};
      } catch { bandsCache[id] = {}; }
    }
    S.bands = bandsCache[id];

    let target = null;
    const landmark = LANDMARKS[a.id];
    if (landmark) {
      try {
        const r = await api('search', { db: a.id, q: landmark });
        const hit = (r.hits || []).find((h) => h.type === 'gene');
        if (hit) {
          const pad = Math.max(4000, Math.round((hit.end - hit.start) * 0.5));
          target = { chrom: hit.chrom, start: hit.start - pad, end: hit.end + pad };
        }
      } catch { /* ignore */ }
    }
    if (!target && a.defaultPos) target = parseLocus(a.defaultPos, a.chroms);
    if (!target) {
      const chrom = Object.keys(a.chroms)[0];
      target = { chrom, start: 0, end: Math.min(a.chroms[chrom], 200000) };
    }
    await navigate(target.chrom, target.start, target.end, { force: true });
    if (S.panels.length > 1) {
      for (const P of S.panels) {
        P.view = { ...S.view };
        P.data = makePanel(null).data;
        P.bwData = {};
      }
      await ensureAll(true);
      syncPaneHeads();
    }
    // P2-2：placeholder 只留最短提示，完整用法放 title（见 index.html）
    if (first) $('#locus').placeholder = T('搜索基因 / 位置');
  }

  function primaryChroms() {
    const a = S.asm;
    return (a.primary && a.primary.length) ? a.primary : Object.keys(a.chroms);
  }

  function genomeTotalLen() {
    let t = 0;
    for (const c of primaryChroms()) t += S.asm.chroms[c] || 0;
    return t;
  }

  /* 染色体下拉（同 IGV 的染色体选择器）：选某条 = 整条染色体视野，
     选「全部染色体」= 全基因组视野（所有染色体并排）。 */
  function renderChromMenu() {
    const menu = $('#chromMenu');
    if (!menu || !S.asm) return;
    const a = S.asm;
    const row = (key, name, len, cur) => {
      const mb = len >= 1e9 ? `${(len / 1e9).toFixed(2)} Gb` : `${(len / 1e6).toFixed(1)} Mb`;
      return `<div class="scope-item${cur ? ' cur' : ''}" data-chrom="${escAttr(key)}" role="option">`
        + `<span class="nm">${escAttr(name)}</span><span class="len">${mb}</span>`
        + `${cur ? '<span class="ck">✓</span>' : ''}</div>`;
    };
    const parts = [row('*', T('全部染色体'), genomeTotalLen(), !!S.genomeView)];
    for (const chrom of primaryChroms()) {
      const len = a.chroms[chrom] || 0;
      parts.push(row(chrom, chrom, len, !S.genomeView && S.view.chrom === chrom));
    }
    menu.innerHTML = parts.join('');
    syncChromPicker();
  }

  // 下拉按钮上的当前值：全基因组视野显示「全部」，否则是当前染色体
  function syncChromPicker() {
    const lab = $('#chromSelLabel');
    if (!lab) return;
    lab.textContent = S.genomeView ? T('全部') : (S.view.chrom || '—');
  }

  function pickChrom(key) {
    if (!S.asm) return;
    if (key === '*') { enterGenomeView(); return; }
    const len = S.asm.chroms[key];
    if (!len) return;
    exitGenomeView();
    navigate(key, 0, len);      // 整条染色体（同 IGV：选染色体 = 看全染色体）
  }

  /* --------------------------------------------------------------- navigation */
  function parseLocus(text, chroms) {
    const t = String(text).trim().replace(/,/g, '');
    const m = t.match(/^([\w.\-]+)(?::(\d+)(?:-(\d+))?)?$/);
    if (!m) return null;
    let chrom = m[1];
    if (!(chrom in chroms)) {
      const alt = chrom.startsWith('chr') ? chrom.slice(3) : 'chr' + chrom;
      if (alt in chroms) chrom = alt;
      else {
        const found = Object.keys(chroms).find((c) => c.toLowerCase() === chrom.toLowerCase());
        if (!found) return null;
        chrom = found;
      }
    }
    const len = chroms[chrom];
    let start;
    let end;
    if (!m[2]) {
      // bare chromosome name: open a window in the middle of the chromosome,
      // where gene density is usually high
      const size = Math.min(len, 200000);
      start = Math.max(0, Math.round(len * 0.5 - size / 2));
      end = Math.min(len, start + size);
    } else {
      start = m[2] ? parseInt(m[2], 10) - 1 : 0;
      end = m[3] ? parseInt(m[3], 10) : start + Math.max(50000, Math.round(len * 0.01));
    }
    start = clamp(start, 0, len - 1);
    end = clamp(end, start + 1, len);
    return { chrom, start, end };
  }

  // 在活动面板上导航（多屏时只影响当前面板）
  async function navigate(chrom, start, end, opts = {}) {
    return navigatePanel(S.act, chrom, start, end, opts);
  }

  async function navigatePanel(idx, chrom, start, end, opts = {}) {
    const P = S.panels[idx];
    if (!P) return;
    const len = S.asm.chroms[chrom];
    if (!len) return;
    // 任何一次正常导航都退出全基因组视野（同 IGV：从 whole genome 跳进某条染色体）
    if (S.genomeView) { S.genomeView = false; syncChromPicker(); }
    const chromChanged = P.view.chrom !== chrom;
    let size = clamp(end - start, 40, len);
    start = clamp(Math.round(start), 0, len - size);
    end = Math.round(start + size);
    P.view = { chrom, start, end };
    if (chromChanged) {
      P.data = makePanel(null).data;
      P.data.range = { start, end };
      P.bwData = {};
      if (idx === S.act) {
        S.sel = null;
        renderChromMenu();
        renderInfo();
      }
    }
    await ensureDataFor(P, idx, opts.force || chromChanged);
    savePrefs();          // 记住每屏的位置，下次打开自动恢复
    scheduleRender();
    if (idx === S.act) updateStatus();
  }

  /* ------------------------------------------------------- 全基因组视野 */
  /* 同 IGV 的 whole genome view：所有染色体按长度比例并排（一条一格），
     点某格 → 整条染色体。染色体下拉里选「全部染色体」进入这里。 */
  function enterGenomeView() {
    if (!S.asm || S.genomeView) return;
    S.genomeView = true;
    closeTrackPop();
    closeBwCtx();
    closeLoadedCtx();
    syncChromPicker();
    renderChromMenu();
    scheduleRender();
    updateStatus();
  }

  function exitGenomeView() {
    if (!S.genomeView) return;
    S.genomeView = false;
    syncChromPicker();
    renderChromMenu();
    scheduleRender();
  }

  function currentDataRange() {
    return dataRangeFor(S.view);
  }

  function dataRangeFor(view) {
    const { start, end } = view;
    const pad = Math.round((end - start) * 0.5);
    // 右边的 padding 要夹到染色体末尾：看整条 chr6 时 end+pad 会到 256 Mb，
    // 多出来的部分既没有数据、又把有限的 bin 摊薄，热图分辨率白白掉 1/3
    const len = (S.asm && S.asm.chroms && S.asm.chroms[view.chrom]) || Infinity;
    return { start: Math.max(0, start - pad), end: Math.min(len, end + pad) };
  }

  // 活动面板刷新（大部分调用点用它）
  function ensureData(force) {
    return ensureDataFor(S.panels[S.act], S.act, force);
  }

  // 全部分屏一起刷新（换装配、加屏、改轨道显隐、窗口缩放）
  function ensureAll(force) {
    return Promise.all(S.panels.map((P, i) => ensureDataFor(P, i, force)));
  }

  async function ensureDataFor(P, idx, force) {
    const view = { ...P.view };
    const asm = S.asm;
    if (!view.chrom || !asm) return;
    const need = dataRangeFor(view);
    const alignNeed = { start: view.start, end: view.end };
    const d = P.data;
    const covered = !force && d.range.start <= need.start && d.range.end >= need.end
      && d.loadedFor === view.chrom;
    const bpPerPx = (view.end - view.start) / paneWidth(idx);
    const wantSeq = bpPerPx <= 1.2 && S.tracks.seq && asm.hasSeq;
    // 缓存只代表已完成的数据；取消旧请求后，缺失的各条轨道仍独立补取。
    if (P._ac) { try { P._ac.abort(); } catch { /* ignore */ } }
    const ac = new AbortController();
    P._ac = ac;
    const sig = ac.signal;
    const current = () => !sig.aborted && P._ac === ac && S.asm === asm
      && S.panels.includes(P) && P.view.chrom === view.chrom
      && P.view.start === view.start && P.view.end === view.end;
    const trackCurrent = (t, alignment = false) => current() && S.bw.list.includes(t)
      && (alignment ? alignActive(t) : bwActive(t));
    const cached = (prev, range) => !force && prev && prev.loaded === true
      && !prev.tooWide && !prev.error && !prev.reason && prev.chrom === view.chrom
      && prev.start <= range.start && prev.end >= range.end;
    S.pending++;
    setLoading(true);
    let counted = true;
    const releaseLoading = () => {
      if (!counted) return;
      counted = false;
      S.pending = Math.max(0, S.pending - 1);
      if (S.pending <= 0) setLoading(false);
    };
    // Aborting a removed/obsolete track releases its UI loading token now;
    // its late finally must not decrement a newer request's loading count.
    sig.addEventListener('abort', releaseLoading, { once: true });
    const t0 = performance.now();
    const jobs = [];
    if (!covered) {
      jobs.push(api('genes', { db: asm.id, chrom: view.chrom, s: need.start, e: need.end }, { signal: sig })
        .then((r) => {
          if (!current()) return;
          d.genes = r.genes; d.truncated = r.truncated; d.ms = r.ms;
          d.range = { ...need }; d.loadedFor = view.chrom;
        })
        .catch((err) => {
          if (current() && err?.name !== 'AbortError') toast(T('数据加载失败：') + err.message);
        }));
    }
    // GC 与序列后台加载，不阻塞其它轨道；迟到结果不可污染新窗口。
    if (S.tracks.gc && asm.hasSeq && !(covered && d.gc && d.gcRange
      && d.gcRange.start <= need.start && d.gcRange.end >= need.end)) {
      d.gc = null;
      api('gc', { db: asm.id, chrom: view.chrom, s: need.start, e: need.end, bins: 700 }, { signal: sig })
        .then((r) => {
          if (!current() || !S.tracks.gc) return;
          d.gc = r.gc; d.gcRange = { ...need }; scheduleRender();
        })
        .catch(() => { /* 取消或失败：保持占位 */ });
    }
    if (wantSeq && !(covered && d.seq && d.seqStart <= need.start
      && d.seqStart + d.seq.length >= need.end)) {
      d.seq = null;
      d.seqStart = null;
      api('seq', { db: asm.id, chrom: view.chrom, s: need.start, e: need.end }, { signal: sig })
        .then((r) => {
          if (!current() || !S.tracks.seq) return;
          d.seq = r.seq; d.seqStart = r.start ?? need.start; scheduleRender();
        })
        .catch(() => { /* 取消或失败：保持占位 */ });
    } else if (!wantSeq) {
      d.seq = null;
    }
    const bins = Math.max(120, Math.min(2400, Math.round(paneWidth(idx))));
    for (const t of S.bw.list) {
      if (!bwActive(t)) continue;
      const range = isBam(t) ? alignNeed : need;
      // IGV 的同一 alignment manager 为覆盖度、reads 和剪接统一控制窗口，先判门槛再查缓存。
      if (isBam(t) && (view.end - view.start) > alignmentVisibility(t)) {
        P.bwData[t.id] = { chrom: view.chrom, ...range, loaded: false, tooWide: true,
          values: null, reason: '放大查看覆盖度（Zoom in to see coverage）' };
        continue;
      }
      if (cached(P.bwData[t.id], range)) continue;
      if (t.heatmap) {
        jobs.push(api('loaded/seg', { track: t.id, chrom: view.chrom, s: range.start, e: range.end, bins }, { signal: sig })
          .then((r) => {
            if (!trackCurrent(t)) return;
            P.bwData[t.id] = { chrom: view.chrom, start: r.start, end: r.end, bins: r.bins,
              rows: r.rows, samples: r.samples, heat: true, loaded: !r.reason && Array.isArray(r.rows), reason: r.reason || null };
          })
          .catch((err) => {
            if (!trackCurrent(t) || err?.name === 'AbortError') return;
            P.bwData[t.id] = { chrom: view.chrom, ...range, loaded: false, error: true,
              rows: null, heat: true, reason: T('读取失败：') + err.message };
          }));
        continue;
      }
      jobs.push(api('bw', { track: t.id, chrom: view.chrom, s: range.start, e: range.end, bins }, { signal: sig })
        .then((r) => {
          if (!trackCurrent(t)) return;
          P.bwData[t.id] = { chrom: view.chrom, start: r.start, end: r.end,
            values: r.values, peak: r.peak, trough: r.trough || 0,
            diverging: !!r.diverging, fileMax: r.fileMax,
            loaded: !r.reason && Array.isArray(r.values), reason: r.reason || null };
        })
        .catch((err) => {
          if (!trackCurrent(t) || err?.name === 'AbortError') return;
          P.bwData[t.id] = { chrom: view.chrom, ...range, loaded: false, error: true,
            values: null, reason: T('读取失败：') + err.message };
        }));
    }
    // 请求整个可见窗口，不传 max，也不以 padding 放大 BAM 读取范围。
    for (const t of S.bw.list) {
      if (!alignActive(t)) continue;
      if ((view.end - view.start) > alignmentVisibility(t)) {
        P.alignData[t.id] = { chrom: view.chrom, ...alignNeed, loaded: false,
          reads: null, tooWide: true, total: 0, reason: '放大查看比对（Zoom in to see alignments）' };
        continue;
      }
      if (cached(P.alignData[t.id], alignNeed)) continue;
      jobs.push(api('loaded/bam', { track: t.id, db: asm.id, chrom: view.chrom,
        s: alignNeed.start, e: alignNeed.end }, { signal: sig })
        .then((r) => {
          if (!trackCurrent(t, true)) return;
          P.alignData[t.id] = { chrom: view.chrom, start: r.start, end: r.end,
            reads: r.reads, total: r.total, sampled: r.sampled,
            loaded: !r.reason && Array.isArray(r.reads), hasSeq: r.hasSeq, reason: r.reason || null };
        })
        .catch((err) => {
          if (!trackCurrent(t, true) || err?.name === 'AbortError') return;
          P.alignData[t.id] = { chrom: view.chrom, ...alignNeed, loaded: false, error: true,
            reads: null, reason: T('读取失败：') + err.message };
        }));
    }
    try {
      await Promise.all(jobs);
    } finally {
      releaseLoading();
      if (current()) {
        $('#stPerf').textContent = T(`载入 ${(performance.now() - t0).toFixed(0)} ms`);
        scheduleRender();
      }
    }
  }

  function setLoading(on) {
    let bar = $('#view .loading-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'loading-bar';
      $('#view').appendChild(bar);
    }
    bar.classList.toggle('on', !!on);
  }

  /* ------------------------------------------------------------------ layout */
  function visibleTrackBody() {
    return document.querySelector('.track:not([hidden]) .track-body');
  }

  /* ---- 分屏（multi-locus split view）--------------------------------------
     单个 track 行 = 左标签列 + 右 body；body 里并排 N 个 .pane，每个 pane
     一张 canvas，对应一个面板（视口）。只有 overview 不分屏（共享）。 */
  function paneCount() { return S.panels.length; }

  function syncPanes() {
    const n = paneCount();
    for (const body of $$('#view .track-body[data-split]')) {
      for (const c of body.querySelectorAll(':scope > canvas')) c.remove();
      let panes = [...body.querySelectorAll(':scope > .pane')];
      while (panes.length < n) {
        const p = document.createElement('div');
        p.className = 'pane';
        p.dataset.p = panes.length;
        p.appendChild(document.createElement('canvas'));
        body.appendChild(p);
        panes.push(p);
      }
      while (panes.length > n) { panes.pop().remove(); }
      body.classList.toggle('panes', n > 1);
      panes.forEach((p, i) => p.classList.toggle('act', i === S.selPane));
    }
  }

  // 重画各屏的「选中」外观（顶部强调线 + 位置格灰底）
  function paintPaneSel() {
    for (const body of $$('#view .track-body.panes')) {
      for (const p of body.querySelectorAll(':scope > .pane')) {
        p.classList.toggle('act', Number(p.dataset.p) === S.selPane);
      }
    }
  }

  /* ---- 分屏竖线（overlay）-----------------------------------------------
     以前竖线是每个 .pane 的 border-left，会在三处断掉：
       1) pane 用 align-items:flex-start，标签列比 canvas 高时 pane 只有 canvas 那么高；
       2) 行与行之间有 1px 的 border-bottom；
       3) 「位置」行（.ph）和「全基因组」行本来就不分屏，根本没有 pane。
     改成在 #view 里铺一层绝对定位的 overlay，从顶拉到内容底，线就不会断。 */
  function syncSplitLines() {
    const view = $('#view');
    if (!view) return;
    const n = paneCount();
    let ov = view.querySelector(':scope > .split-lines');
    if (n < 2) { if (ov) ov.remove(); return; }
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'split-lines';
      view.appendChild(ov);
    }
    // 以标尺行的 pane 为基准（它一定存在、一定分屏）；高度取内容总高
    const xs = [];
    for (let i = 1; i < n; i++) {
      const p = view.querySelector(`.track[data-track="ruler"] .pane[data-p="${i}"]`)
        || view.querySelector(`.pane[data-p="${i}"]`);
      if (p) xs.push(p.getBoundingClientRect().left);
    }
    if (!xs.length) return;
    ov.style.height = '0px';   // 先归零，否则绝对定位的自己会把 scrollHeight 撑住
    const h = Math.max(view.scrollHeight, view.clientHeight);
    ov.style.height = h + 'px';
    const vb = view.getBoundingClientRect();
    while (ov.children.length > xs.length) ov.lastElementChild.remove();
    while (ov.children.length < xs.length) ov.appendChild(document.createElement('i'));
    // 竖线必须落在整设备像素上：1 CSS px 在 150% 缩放下是 1.5 个设备像素，
    // 浏览器只能按亚像素相位各自取整成 1 或 2 个，于是同一屏里两根线一粗一细
    // （截图里甚至两张图「哪根粗」是反的）。这里把宽度和位置都换算成整设备像素。
    const dpr = window.devicePixelRatio || 1;
    const devW = Math.max(1, Math.round(dpr));   // 目标粗细（设备像素）
    const cssW = devW / dpr;
    xs.forEach((x, i) => {
      const el = ov.children[i];
      const devX = Math.round((x - vb.left) * dpr - devW / 2);   // 线中心压在分界上
      el.style.width = cssW + 'px';
      el.style.left = (devX / dpr) + 'px';
    });
  }

  // 面板 i 的可用绘图宽度（所有 pane 等宽，任取一个即可）
  function paneWidth(i) {
    const el = document.querySelector(`#view .pane[data-p="${i}"]`);
    if (el) return Math.max(80, el.clientWidth);
    const body = visibleTrackBody();
    return Math.max(200, body ? body.clientWidth : 400);
  }

  // 当前活动面板里某条轨道的 canvas
  function paneCanvas(sel) {
    const row = typeof sel === 'string' ? $(sel) : sel;
    if (!row) return null;
    const pane = row.querySelector(`.pane[data-p="${S.act}"]`);
    if (pane) return pane.querySelector('canvas');
    return row.querySelector('canvas');
  }

  // 定位一次鼠标事件落在哪个面板（只读，不切换活动面板）
  function eventPane(e) {
    const pane = e.target.closest ? e.target.closest('.pane') : null;
    if (pane) {
      const idx = Number(pane.dataset.p);
      return { idx: Number.isFinite(idx) ? idx : S.act, el: pane,
        rect: pane.getBoundingClientRect() };
    }
    const body = e.target.closest ? e.target.closest('.track-body') : null;
    return { idx: S.act, el: body, rect: body ? body.getBoundingClientRect() : null };
  }

  // 临时以某个面板为上下文执行（用于 hover 命中等开销很小的只读计算）
  function withPanel(idx, fn) {
    const keep = S.act;
    if (idx !== keep) S.act = idx;
    try { return fn(); } finally { S.act = keep; }
  }

  function setActivePanel(idx) {
    if (idx < 0 || idx >= S.panels.length) return;
    const changed = idx !== S.act || idx !== S.selPane;
    S.act = idx;
    S.selPane = idx;
    if (!changed) return;
    paintPaneSel();
    syncPaneHeads();
    updateStatus();
    scheduleRender();
  }

  // 点某屏一次 = 选中；在同一屏再点一次 = 取消选中（只是取消高亮，操作目标仍是这一屏）
  function togglePane(idx) {
    if (idx < 0 || idx >= S.panels.length) return;
    if (S.selPane === idx) {
      S.selPane = -1;
    } else {
      S.selPane = idx;
      S.act = idx;
    }
    paintPaneSel();
    syncPaneHeads();
    updateStatus();
  }

  /* ---- 分屏管理（1–5 屏，每屏独立视口）-------------------------------- */
  function viewLabel(v) {
    return v && v.chrom ? `${v.chrom}:${fmt(v.start + 1)}-${fmt(v.end)}` : '—';
  }

  function syncPaneHeads() {
    const box = $('#paneHeads');
    const row = $('#paneHead');
    if (!box || !row) return;
    const n = paneCount();
    row.hidden = n === 1 || !!S.genomeView;
    if (n === 1) { box.innerHTML = ''; return; }
    if (box.children.length !== n) {
      box.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const cell = document.createElement('div');
        cell.className = 'ph';
        cell.dataset.p = i;
        const inp = document.createElement('input');
        inp.className = 'ph-in';
        inp.spellcheck = false;
        inp.title = T('输入基因名或位置后回车：TP53 / chr17:7,660,000-7,690,000');
        const x = document.createElement('button');
        x.className = 'ph-x';
        x.textContent = '×';
        x.title = T('关闭这一屏');
        x.onclick = (ev) => { ev.stopPropagation(); closePanel(i); };
        inp.addEventListener('focus', () => setActivePanel(i));
        inp.addEventListener('click', (ev) => ev.stopPropagation());
        inp.addEventListener('keydown', (ev) => {
          ev.stopPropagation();
          if (ev.key === 'Enter') { ev.preventDefault(); goPanel(i, inp.value); inp.blur(); }
          if (ev.key === 'Escape') { inp.value = viewLabel(S.panels[i].view); inp.blur(); }
        });
        cell.addEventListener('mousedown', (ev) => {
          if (ev.target === inp || ev.target === x) return;
          togglePane(i);
        });
        cell.append(inp, x);
        box.appendChild(cell);
      }
    }
    [...box.children].forEach((cell, i) => {
      cell.classList.toggle('act', i === S.selPane);
      const inp = cell.querySelector('.ph-in');
      if (document.activeElement !== inp) inp.value = viewLabel(S.panels[i].view);
    });
  }

  // 在指定分屏里跳到某个基因 / 位置
  async function goPanel(idx, text) {
    const raw = String(text || '').trim();
    if (!raw || !S.asm) return;
    let v = parseLocus(raw, Object.keys(S.asm.chroms));
    if (!v) {
      try {
        const r = await api('search', { db: S.asm.id, q: raw });
        const hits = r.hits || [];
        const hit = hits.find((h) => h.type === 'gene') || hits[0];
        if (!hit) { toast(T(`没找到：${raw}`)); return; }
        if (hit.type === 'locus') {
          v = { chrom: hit.chrom, start: hit.start, end: hit.end };
        } else {
          const pad = Math.max(3000, Math.round((hit.end - hit.start) * 0.35));
          v = { chrom: hit.chrom, start: hit.start - pad, end: hit.end + pad };
        }
      } catch (err) { toast(T('搜索失败：') + err.message); return; }
    }
    setActivePanel(idx);
    await navigatePanel(idx, v.chrom, v.start, v.end, { force: true });
    syncPaneHeads();
    scheduleRender();
  }

  function setPanelCount(n) {
    n = clamp(Math.round(n), 1, 5);
    if (n === S.panels.length) { syncPaneHeads(); return; }
    const base = S.panels[S.act] ? S.panels[S.act].view : S.view;
    while (S.panels.length < n) S.panels.push(makePanel(base));
    while (S.panels.length > n) S.panels.pop();
    S.act = Math.min(S.act, n - 1);
    if (S.selPane >= n) S.selPane = -1;
    savePrefs();
    syncPanes();
    syncPaneHeads();
    renderSplitMenu();
    ensureAll(true).then(() => scheduleRender());
  }

  function closePanel(idx) {
    if (S.panels.length <= 1) return;
    S.panels.splice(idx, 1);
    S.act = clamp(S.act > idx ? S.act - 1 : S.act, 0, S.panels.length - 1);
    if (S.selPane === idx) S.selPane = -1;
    else if (S.selPane > idx) S.selPane -= 1;
    savePrefs();
    syncPanes();
    syncPaneHeads();
    renderSplitMenu();
    scheduleRender();
  }

  // 恢复上次的分屏布局（仅在「刷新」或显式 ?loci= 时调用，见 boot）
  async function restoreSplit(lociList) {
    if (!S.asm) return;
    const sp = S._splitPref || {};
    const loci = lociList || (Array.isArray(sp.loci) ? sp.loci : []);
    const n = clamp(lociList ? lociList.length : (Number(sp.count) || 1), 1, 5);
    if (n <= 1) return;
    const base = S.view;
    while (S.panels.length < n) S.panels.push(makePanel(base));
    while (S.panels.length > n) S.panels.pop();
    for (let i = 0; i < n; i++) {
      const v = loci[i];
      if (v && v.chrom && S.asm.chroms[v.chrom]) {
        const start = Math.max(0, Math.round(Number(v.start) || 0));
        const end = Math.max(start + 40, Math.round(Number(v.end) || (start + 100000)));
        S.panels[i].view = { chrom: v.chrom, start, end };
        S.panels[i].data = makePanel(null).data;
        S.panels[i].bwData = {};
      }
    }
    S.act = 0;
    S.selPane = 0;
    syncPanes();
    syncPaneHeads();
    renderSplitMenu();
    await ensureAll(true);
    scheduleRender();
  }

  function renderSplitMenu() {
    const box = $('#splitMenu');
    if (!box) return;
    const n = paneCount();
    const btn = $('#btnSplit');
    if (btn) {
      btn.classList.toggle('on', n > 1);
      btn.title = n > 1 ? T(`当前 ${n} 屏 · 每屏可独立导航`) : T('多位置分屏：同时看多个基因');
    }
    box.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement('button');
      b.className = 'sm-item' + (i === n ? ' on' : '');
      b.innerHTML = T(`<span>${i} 屏</span><span class="muted">${i === 1 ? T('单视图') : T('并排')}</span>`);
      b.onclick = () => { setPanelCount(i); box.hidden = true; };
      box.appendChild(b);
    }
    const hint = document.createElement('div');
    hint.className = 'sm-hint';
    hint.textContent = n > 1
      ? T('点某一屏成为活动面板后，搜索框/键盘只作用于该屏；也可在「位置」行直接输入基因名。')
      : T('分屏后每屏独立导航，可同时看多个基因。');
    box.appendChild(hint);
  }

  /* 每个面板的内容宽度缓存。px() 一帧会被调用上万次（每个基因、每个外显子、每个碱基），
     而 paneWidth() 是 querySelector + clientWidth —— 整条染色体（1800+ 基因）下实测
     这一项占了渲染时间的 30% 以上。render() 开头统一刷新一次即可。 */
  let _paneW = [];
  function refreshPaneW() {
    const n = Math.max(1, S.panels.length);
    const next = new Array(n);
    for (let i = 0; i < n; i++) next[i] = paneWidth(i);
    _paneW = next;
  }

  function trackWidth() {
    const w = _paneW[S.act];
    return w || paneWidth(S.act);
  }

  /* ---- 导出（轨道绘制区 + 可选的最左侧轨道名列）----------------------- */
  const EXPORT_SCALE = 2; // 2× 设备像素，够打印
  S.expLabels = (() => {
    try { return localStorage.getItem('orbit.expLabels') !== '0'; } catch { return true; }
  })();

  // 轨道标签：主名（直接文本节点）+ 副标题（.sub）
  function labelText(lab) {
    let main = '';
    for (const n of lab.childNodes) if (n.nodeType === 3) main += n.nodeValue;
    // 信号轨道的名字放在 <span class="nm"> 里，不是直接文本节点，光看 childNodes 会读成空
    const nmEl = lab.querySelector('.nm');
    if (!main.trim() && nmEl) main = nmEl.textContent;
    const subEl = lab.querySelector('.sub');
    const colorOf = (el) => {
      try { return getComputedStyle(el).color; } catch { return ''; }
    };
    return {
      main: main.trim(),
      sub: subEl ? subEl.textContent.trim() : '',
      mainColor: nmEl ? colorOf(nmEl) : colorOf(lab),
      mono: !!nmEl,
    };
  }

  // 按宽度截断成「…」，和 CSS 的 text-overflow: ellipsis 一致
  function fitLabel(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  // 参与导出的轨道行（跳过隐藏轨道与 DOM 类型的「位置」行）
  function plotRows() {
    const rows = [];
    for (const tr of $$('#view .track')) {
      if (tr.hidden || tr.offsetParent === null) continue;
      if (tr.classList.contains('pane-head')) continue;
      const body = tr.querySelector('.track-body');
      if (!body) continue;
      const br = body.getBoundingClientRect();
      if (br.width < 2 || br.height < 2) continue;
      const lab = tr.querySelector('.track-label');
      const lr = lab ? lab.getBoundingClientRect() : null;
      rows.push({ body, br, rect: tr.getBoundingClientRect(),
        label: lab && lr ? { rect: lr, ...labelText(lab) } : null });
    }
    return rows;
  }

  // 名称列宽度：标签列右边界到绘图区左边界
  function exportSepX(rows, x0) {
    const withLab = rows.filter((r) => r.label);
    if (!withLab.length) return 0;
    const sepX = Math.max(...withLab.map((r) => r.label.rect.right)) - x0;
    return Number.isFinite(sepX) && sepX > 0 ? sepX : 0;
  }

  // 把左侧标签列画出来（canvas 里没法直接截 DOM，所以按同样的字号/颜色重绘一遍）
  function drawExportLabels(ctx, rows, x0, y0, sepX) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (const r of rows) {
      if (!r.label) continue;
      const top = r.br.top - y0;
      ctx.fillStyle = C.panel;
      ctx.fillRect(0, top, sepX, r.br.height);
      const maxW = sepX - 12;
      if (r.label.main) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = r.label.mainColor || C.muted;
        ctx.font = r.label.mono
          ? '10.5px ui-monospace, Menlo, Consolas, monospace'
          : '11px system-ui, -apple-system, "Segoe UI", sans-serif';
        ctx.fillText(fitLabel(ctx, r.label.main, maxW), 8, top + (r.label.mono ? 8 : 6));
      }
      if (r.label.sub) {
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = C.muted;
        ctx.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
        ctx.fillText(fitLabel(ctx, r.label.sub, maxW), 8, top + 20);
      }
    }
    ctx.restore();
  }

  function drawExportLabelText(ctx, text, x, y, rowH) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.muted;
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(text, x + 8, y + (rowH - 11) / 2, 90);
    ctx.restore();
  }

  function drawExportSep(ctx, sepX, cssH) {
    ctx.save();
    // 这一条是「标签列 ↔ 内容区」的分界，网页上是 .track-label{border-right} 的淡线，
    // 不是分屏竖线，所以保持淡色（分屏竖线见 drawExportGrid）
    ctx.strokeStyle = C.borderSoft;
    ctx.beginPath();
    ctx.moveTo(Math.round(sepX) + 0.5, 0);
    ctx.lineTo(Math.round(sepX) + 0.5, cssH);
    ctx.stroke();
    ctx.restore();
  }

  // 分屏时把每屏的位置区间画成一行抬头（单屏时标尺右上角本来就有胶囊）
  function drawExportHead(ctx, x0, width, rowH) {
    const panes = [...$$('#view .track[data-track="ruler"] .pane')];
    if (!panes.length) return;
    ctx.save();
    ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.text;
    panes.forEach((pane, i) => {
      const pr = pane.getBoundingClientRect();
      const txt = viewLabel((S.panels[i] || {}).view);
      ctx.fillText(txt, pr.left - x0 + pr.width / 2, rowH / 2, pr.width - 8);
    });
    ctx.restore();
    void width;
  }

  // 「位置」抬头要插在染色体示意图那一行的下面（和网页 DOM 顺序一致：染色体 → 位置 → 标尺…），
  // 而不是整张图的顶端。返回抬头在成图坐标系里的 y（0 起），以及各行的 y 偏移规则。
  function exportLayout(rows, y0) {
    const headH = paneCount() > 1 ? 20 : 0;
    let headTop = 0;
    if (headH) {
      const ideo = rows.find((r) => r.body.parentElement
        && r.body.parentElement.dataset.track === 'ideogram');
      // 抬头紧跟在示意图行之后；示意图缺省时退到最顶
      headTop = ideo ? Math.round(ideo.rect.bottom - y0) : 0;
    }
    // 每行的偏移：示意图之上的行不动；之下的行整体下移 headH
    return { headH, headTop };
  }

  // 某行画布在成图里要不要下移 headH（位置抬头插在示意图之后）
  function rowDy(rows, r, headH, headTop, y0) {
    if (!headH) return 0;
    // 这一行的底边在抬头之上 → 不位移；之下 → 下移 headH
    const bottom = r.rect.bottom - y0;
    return bottom <= headTop + 0.5 ? 0 : headH;
  }

  // 按 scale 倍重新渲染再拼成一张图（S.dpr 临时调高 → 画布本身就是高清，1:1 贴过来）
  /* 导出图里的分隔线：轨道行之间的横线 + 分屏之间的竖线。
     这两样在网页上是 CSS 边框（.track{border-bottom}、.pane{border-left}），
     位图和矢量导出都抓不到 DOM，只能按量到的几何再画一遍。 */
  function drawExportGrid(ctx, rows, x0, y0, headH, headTop, w, h) {
    const panes = [...$$('#view .track[data-track="ruler"] .pane')];
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    // 轨道行之间的横线：保持淡，不抢内容
    ctx.strokeStyle = C.borderSoft;
    ctx.beginPath();
    for (const r of rows) {
      const y = Math.round(r.rect.bottom - y0 + rowDy(rows, r, headH, headTop, y0)) - 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    if (headH) {
      ctx.moveTo(0, headTop - 0.5);
      ctx.lineTo(w, headTop - 0.5);
    }
    ctx.stroke();
    // 分屏之间的竖线：单独用深色，和网页上的 .pane{border-left} 保持一致
    if (panes.length > 1) {
      ctx.strokeStyle = C.paneLine;
      ctx.beginPath();
      for (let i = 1; i < panes.length; i++) {
        const x = Math.round(panes[i].getBoundingClientRect().left - x0) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function composePlot(scale = EXPORT_SCALE) {
    const oldDpr = S.dpr;
    S.dpr = scale;
    render();
    try {
      const rows = plotRows();
      if (!rows.length) throw new Error(T('没有可导出的轨道'));
      const withLabels = S.expLabels;
      const leftOf = (r) => (withLabels && r.label ? r.label.rect.left : r.br.left);
      const x0 = Math.min(...rows.map(leftOf));
      const x1 = Math.max(...rows.map((r) => r.br.right));
      const y0 = Math.min(...rows.map((r) => r.br.top));
      const y1 = Math.max(...rows.map((r) => r.br.bottom));
      const { headH, headTop } = exportLayout(rows, y0);
      const cssW = Math.max(1, x1 - x0);
      const cssH = Math.max(1, y1 - y0 + headH);
      const cv = document.createElement('canvas');
      cv.width = Math.round(cssW * scale);
      cv.height = Math.round(cssH * scale);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.scale(scale, scale);
      const sepX = withLabels ? exportSepX(rows, x0) : 0;
      if (headH) {
        // 抬头背景 / 左侧「位置」标签画在示意图行下方
        ctx.save();
        ctx.translate(0, headTop);
        if (sepX) {
          ctx.fillStyle = C.panel;
          ctx.fillRect(0, 0, sepX, headH);
          drawExportLabelText(ctx, T('位置'), 0, 0, headH);
        }
        drawExportHead(ctx, x0, cssW, headH, sepX);
        ctx.restore();
      }
      if (sepX) {
        // 左侧名称列：示意图之上的行不动，之下的行下移 headH
        ctx.save();
        drawExportLabels(ctx, rows.filter((r) => rowDy(rows, r, headH, headTop, y0) === 0), x0, y0, sepX);
        ctx.translate(0, headH);
        drawExportLabels(ctx, rows.filter((r) => rowDy(rows, r, headH, headTop, y0) > 0), x0, y0, sepX);
        ctx.restore();
      }
      for (const r of rows) {
        const dy = rowDy(rows, r, headH, headTop, y0);
        for (const c of r.body.querySelectorAll('canvas')) {
          const cr = c.getBoundingClientRect();
          ctx.drawImage(c, cr.left - x0, cr.top - y0 + dy, cr.width, cr.height);
        }
      }
      drawExportGrid(ctx, rows, x0, y0, headH, headTop, cssW, cssH);
      if (sepX) drawExportSep(ctx, sepX, cssH);
      return cv;
    } finally {
      S.dpr = oldDpr;
      render();
    }
  }

  /* ---- 矢量导出（SVG / PDF）---------------------------------------------
     把同一批绘制函数再跑一遍，但这次 ctx 换成 VEX 记录器：每个 canvas 先
     setTransform 到它在成图里的位置，于是绘制调用记下来的就是「可缩放」的
     线段/矩形/文字，而不是像素。PNG 仍走 composePlot（位图）。            */
  async function composeVector() {
    const rows = plotRows();
    if (!rows.length) throw new Error(T('没有可导出的轨道'));
    const withLabels = S.expLabels;
    const leftOf = (r) => (withLabels && r.label ? r.label.rect.left : r.br.left);
    const x0 = Math.min(...rows.map(leftOf));
    const x1 = Math.max(...rows.map((r) => r.br.right));
    const y0 = Math.min(...rows.map((r) => r.br.top));
    const y1 = Math.max(...rows.map((r) => r.br.bottom));
    const { headH, headTop } = exportLayout(rows, y0);
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0 + headH);
    const rec = new VEX.Rec();
    const map = new Map();
    for (const r of rows) {
      const dy = rowDy(rows, r, headH, headTop, y0);
      for (const c of r.body.querySelectorAll('canvas')) {
        const cr = c.getBoundingClientRect();
        map.set(c, { x: cr.left - x0, y: cr.top - y0 + dy, w: cr.width });
      }
    }

    // 抬头 / 左侧名称列：和位图导出共用同一套函数，只是把 ctx 换成记录器
    const sepX = withLabels ? exportSepX(rows, x0) : 0;
    if (headH) {
      rec.save();
      rec.setTransform(1, 0, 0, 1, 0, headTop);
      if (sepX) {
        rec.fillStyle = C.panel;
        rec.fillRect(0, 0, sepX, headH);
        drawExportLabelText(rec, T('位置'), 0, 0, headH);
      }
      drawExportHead(rec, x0, w, headH, sepX);
      rec.restore();
    }
    if (sepX) {
      drawExportLabels(rec, rows.filter((r) => rowDy(rows, r, headH, headTop, y0) === 0), x0, y0, sepX);
      rec.save();
      rec.setTransform(1, 0, 0, 1, 0, headH);
      drawExportLabels(rec, rows.filter((r) => rowDy(rows, r, headH, headTop, y0) > 0), x0, y0, sepX);
      rec.restore();
    }

    const oldDpr = S.dpr;
    S.dpr = 1;                       // 矢量里 1px 就是 1px，不需要超采样
    VECMAP = { rec, map };
    try {
      render();                      // 同一批 draw 函数，只是画进了记录器
      if (rec._cvOpen) { rec.restore(); rec._cvOpen = false; }   // 收掉最后一块画布的裁剪
    } finally {
      VECMAP = null;
      S.dpr = oldDpr;
      render();                      // 恢复屏幕上的位图渲染
    }
    rec.setTransform(1, 0, 0, 1, 0, 0);
    drawExportGrid(rec, rows, x0, y0, headH, headTop, w, h);
    if (sepX) drawExportSep(rec, sepX, h);
    return { ops: rec.ops, w, h };
  }

  let CJK_FONT = null;
  // 字体来源：优先后端接口（读系统字体，不随包分发），其次 web/font/cjk.ttf（老版本 exe 没有接口时用）
  async function loadCJKFont() {
    if (CJK_FONT) return CJK_FONT;
    const sources = ['api/font', 'font/cjk.ttf'];
    for (const url of sources) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length < 4096) continue;
        CJK_FONT = VEX.parseFont(buf);
        return CJK_FONT;
      } catch { /* 换下一个来源 */ }
    }
    throw new Error(T('没有可用的中文字体：可在 web/font/cjk.ttf 放一份，或用环境变量 IGV_FONT 指定'));
  }

  function exportName(ext) {
    const v = S.view || {};
    const base = `${S.asm.id}_${v.chrom || 'chr'}_${fmt(v.start + 1)}-${fmt(v.end)}`.replace(/,/g, '');
    const suffix = paneCount() > 1 ? `_split${paneCount()}` : '';
    return `${base}${suffix}.${ext}`;
  }

  // 桌面版（Qt 窗口）里 <a download> 会被 QtWebEngine 的 downloadRequested 接住，
  // 弹系统「另存为」；浏览器里就是普通下载。两条路都不需要额外代码。
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // 旧的「SVG 里塞一张 PNG」已删除：SVG/PDF 都改走 composeVector + VEX（真矢量）


  async function deflateBytes(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { return null; }
  }

  // 最小可用 PDF（单页 + 一张 DeviceRGB 位图），不依赖任何库
  async function pdfFromCanvas(cv, scale) {
    const w = cv.width, h = cv.height;
    const src = cv.getContext('2d').getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < src.length; i += 4) {
      rgb[j++] = src[i]; rgb[j++] = src[i + 1]; rgb[j++] = src[i + 2];
    }
    const packed = await deflateBytes(rgb);
    const pw = (w / scale) * 0.75; // CSS px @96dpi → pt
    const ph = (h / scale) * 0.75;

    const enc = new TextEncoder();
    const chunks = [];
    let len = 0;
    const push = (x) => {
      const u8 = typeof x === 'string' ? enc.encode(x) : x;
      chunks.push(u8);
      len += u8.length;
    };
    const offsets = [];
    const obj = (n, dict, stream) => {
      offsets[n] = len;
      push(`${n} 0 obj\n${dict}\n`);
      if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
      push('endobj\n');
    };

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    obj(1, '<</Type/Catalog/Pages 2 0 R>>');
    obj(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>');
    obj(3, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}]`
      + '/Resources<</XObject<</Im0 4 0 R>>>>/Contents 5 0 R>>');
    const filter = packed ? '/Filter/FlateDecode' : '';
    obj(4, `<</Type/XObject/Subtype/Image/Width ${w}/Height ${h}/ColorSpace/DeviceRGB`
      + `/BitsPerComponent 8${filter}/Length ${packed ? packed.length : rgb.length}>>`,
      packed || rgb);
    const content = enc.encode(`q ${pw.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm /Im0 Do Q\n`);
    obj(5, `<</Length ${content.length}>>`, content);

    const xref = len;
    push(`xref\n0 6\n0000000000 65535 f \n`);
    for (let n = 1; n <= 5; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`);

    return new Blob(chunks, { type: 'application/pdf' });
  }

  async function doExport(kind) {
    if (!S.asm || !S.view.chrom) { toast(T('先选择一个位置')); return; }
    toast(T(`正在导出 ${kind.toUpperCase()}…`));
    try {
      if (kind === 'png') {
        const cv = composePlot(EXPORT_SCALE);
        const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
        downloadBlob(blob, exportName('png'));
        toast(T(`已导出 PNG（${cv.width}×${cv.height}）`));
        return;
      }
      const vec = await composeVector();
      const title = exportName(kind);
      if (kind === 'svg') {
        const txt = VEX.toSVG(vec.ops, vec.w, vec.h, { title });
        downloadBlob(new Blob([txt], { type: 'image/svg+xml' }), title);
        toast(T(`已导出矢量 SVG（${Math.round(vec.w)}×${Math.round(vec.h)}，${vec.ops.length} 个图元）`));
        return;
      }
      // PDF：矢量 + 嵌入中文字体；拿不到系统字体时退回位图 PDF，保证还能出图
      let font = null;
      try { font = await loadCJKFont(); } catch { font = null; }
      if (font) {
        const blob = await VEX.toPDF(vec.ops, vec.w, vec.h, font, { title });
        downloadBlob(blob, title);
        toast(T(`已导出矢量 PDF（${Math.round(vec.w)}×${Math.round(vec.h)}，${Math.round(blob.size / 1024)} KB）`));
      } else {
        const cv = composePlot(EXPORT_SCALE);
        const blob = await pdfFromCanvas(cv, EXPORT_SCALE);
        downloadBlob(blob, title);
        toast(T('未找到系统中文字体，已导出位图 PDF（IGV_FONT 可指定字体）'));
      }
    } catch (err) {
      toast(T('导出失败：') + err.message);
    }
  }

  function renderExportMenu() {
    const box = $('#expMenu');
    if (!box) return;
    box.innerHTML = '';
    const chk = document.createElement('label');
    chk.className = 'sm-item sm-chk';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = S.expLabels !== false;
    cb.onchange = () => {
      S.expLabels = cb.checked;
      try { localStorage.setItem('orbit.expLabels', cb.checked ? '1' : '0'); } catch { /* ignore */ }
    };
    chk.append(cb, Object.assign(document.createElement('span'), { textContent: T('包含左侧轨道名') }));
    box.appendChild(chk);
    const items = [
      ['png', 'PNG', T(`位图 ${EXPORT_SCALE}×`)],
      ['svg', 'SVG', T('矢量（可编辑）')],
      ['pdf', 'PDF', T('矢量 · 内嵌字体')],
    ];
    for (const [kind, label, note] of items) {
      const b = document.createElement('button');
      b.className = 'sm-item';
      b.innerHTML = `<span>${label}</span><span class="muted">${note}</span>`;
      b.onclick = () => { box.hidden = true; doExport(kind); };
      box.appendChild(b);
    }
    const hint = document.createElement('div');
    hint.className = 'sm-hint';
    hint.textContent = T('SVG / PDF 为矢量：线条与文字都能在 Illustrator 里逐个选中删除（PDF 已内嵌中文字体）。PNG 为 ') + EXPORT_SCALE + T('× 位图。');
    box.appendChild(hint);
  }

  // 矢量导出时，画布 → 记录器 的临时映射（见 composeVector）
  let VECMAP = null;

  function fitCanvas(canvas, height) {
    if (VECMAP && canvas) {
      const t = VECMAP.map.get(canvas);
      if (t) {
        const rec = VECMAP.rec;
        // 网页上每块 canvas 会把自己的绘制裁在框内；记录器没有边界，不主动裁的话
        // 越过窗口的柱子/标签会溢出到左侧名称列或隔壁分屏里去
        if (rec._cvOpen) { rec.restore(); rec._cvOpen = false; }
        rec.setTransform(1, 0, 0, 1, t.x, t.y);
        rec.save();
        rec.beginPath();
        rec.rect(0, 0, t.w, height);
        rec.clip();
        rec._cvOpen = true;
        rec.beginPath();
        return { ctx: rec, w: t.w, h: height };
      }
    }
    const w = canvas.parentElement.clientWidth;
    const dpr = S.dpr;
    const cw = Math.max(1, Math.round(w * dpr));
    const ch = Math.max(1, Math.round(height * dpr));
    // 尺寸没变就不要重设 width/height：赋值会重新分配后备存储（整块重分配 + 全清），
    // 每帧都做一次是白白烧掉的时间
    canvas.style.height = height + 'px';
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    return { ctx, w, h: height };
  }

  let raf = 0;
  function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; render(); });
  }

  /* ------------------------------------------------------------------ render */
  function render() {
    if (!S.asm) return;
    syncPanes();
    refreshPaneW();   // px() 靠它，必须先于任何绘制
    const gv = !!S.genomeView;
    const gtrack = $('#view .track[data-track="genome"]');
    if (gtrack) gtrack.hidden = !gv;
    for (const name of ['ideogram', 'ruler', 'genes', 'gc', 'seq', 'overview']) {
      const track = $(`.track[data-track="${name}"]`);
      if (!track) continue;
      track.hidden = gv || !S.tracks[name];
      if (track.hidden) continue;
    }
    // 全基因组视野里把信号 / 导入轨道也一起收起，只留一条「所有染色体」的带子；
    // 例外是多样本 SEG 热图——IGV 的 whole-genome 视图会把 CNV 铺成「染色体 × 样本」整块图
    for (const el of $$('#view .track[data-bw], #view .track[data-loaded], #view .track[data-align], #view .track[data-junc]')) {
      const isHeat = el.dataset.bw && (S.bw.list.find((t) => t.id === el.dataset.bw) || {}).heatmap;
      el.hidden = gv ? !isHeat : el.hidden;
    }
    if (gv) {
      drawGenomeView();
      drawBwTracks();
      const sub = $('#gvSub');
      if (sub) sub.textContent = T(`${(S._gvSlots || []).length} 条`);
      syncPaneHeads();
      syncOverviewCtl();
      updateStatus();
      return;
    }
    const keep = S.act;
    // 逐面板绘制：切换活动面板上下文，原有绘制函数无需改签名
    for (let i = 0; i < S.panels.length; i++) {
      S.act = i;
      if (S.tracks.ideogram) drawIdeogram();   // 分屏时每屏画自己那条染色体（同 IGV）
      if (S.tracks.ruler) drawRuler();
      drawBwTracks();
      drawAlignTracks();
      drawJunctionTracks();
      drawLoadedTracks();
      if (S.tracks.genes) drawGenes(); else { S._geneToggles = []; }
      if (S.tracks.gc) drawGC();
      if (S.tracks.seq) drawSeq();
      drawMotifs();                            // motif 轨道（会话内）
      if (S.tracks.overview) drawOverview();   // 全基因组总览也按屏画（各自染色体/视野框）
    }
    S.act = keep;
    syncPaneHeads();
    syncSplitLines();
    syncOverviewCtl();
    refreshTrackLabels();
    refreshMotifLabels();
    updateStatus();
  }

  // 轨道左侧的单行标签（基因数量 / 序列提示）跟活动面板保持一致
  function refreshTrackLabels() {
    const d = S.view && S.view.chrom ? S.data : null;
    if (!d) return;
    const idc = $('#ideoChrom');
    // 分屏后每屏画自己的染色体，左侧不再标单一染色体名（同 IGV）
    if (idc) idc.textContent = paneCount() > 1 ? '' : (S.view.chrom || '');
    const gc = $('#geneCount');
    if (gc && S.tracks.genes) {
      const cnt = (d.genes || []).length;
      gc.textContent = cnt ? T(`${cnt}${d.truncated ? '+' : ''} 个基因`) : T('无');
    }
  }

  const px = (bp) => (bp - S.view.start) / ((S.view.end - S.view.start) / trackWidth());
  const bpAt = (x) => S.view.start + x * ((S.view.end - S.view.start) / trackWidth());

  function drawRuler() {
    const canvas = paneCanvas('.track[data-track="ruler"]');
    const { ctx, w, h } = fitCanvas(canvas, 30);
    const bpPerPx = (S.view.end - S.view.start) / w;
    const targetPx = 110;
    const rawStep = bpPerPx * targetPx;
    const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const mult = [1, 2, 5, 10].find((m) => m * pow >= rawStep) || 10;
    const step = mult * pow;

    ctx.font = '10.5px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = C.grid;
    ctx.fillStyle = C.muted;
    ctx.beginPath();
    const first = Math.ceil(S.view.start / step) * step;
    for (let bp = first; bp <= S.view.end; bp += step) {
      const x = Math.round(px(bp)) + 0.5;
      ctx.moveTo(x, h - 9);
      ctx.lineTo(x, h);
      const label = fmt(bp);
      const tw = ctx.measureText(label).width;
      ctx.fillText(label, clamp(x - tw / 2, 2, w - tw - 2), h / 2 - 2);
    }
    ctx.stroke();
    // locus pill —— 分屏时每个面板的「位置」行已居中显示区间，这里不再重复画
    if (paneCount() === 1) {
      const locusTxt = `${S.view.chrom}:${fmt(S.view.start + 1)}-${fmt(S.view.end)}`;
      ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
      const lw = ctx.measureText(locusTxt).width;
      ctx.fillStyle = C.bg;
      ctx.globalAlpha = 0.92;
      ctx.fillRect(w - lw - 16, 2, lw + 12, 16);
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.accent;
      ctx.fillText(locusTxt, w - lw - 10, 10);
    }
  }

  /* 染色体示意图：完全照 IGV 桌面版 CytobandRenderer.drawBand 的算法来
     - gneg/gvar/stalk → 白色；gposNN → 灰阶 255 - NN/100*255（25→191、50→127、75→64、100→0）
     - 每个带填色后描 1px 边框（亮色主题黑、暗色主题灰）
     - acen（着丝粒）不填矩形，而是画三角形，颜色 Color.RED.darker() = #B20000：
       p 端底边在整个带的左边界、顶点在右边界中线；q 端相反 → 两个三角形在中心汇成沙漏
     - 当前视图区间：IGV 用红色三层嵌套矩形（只在放大时画）                            */
  function drawIdeogram() {
    const canvas = paneCanvas('.track[data-track="ideogram"]');
    const { ctx, w, h } = fitCanvas(canvas, 34);
    const chromLen = S.asm.chroms[S.view.chrom];
    const bands = (S.bands || {})[S.view.chrom] || [];
    const y0 = 9, bh = 15;
    const sx = (bp) => (bp / chromLen) * w;

    // 设备像素对齐，1px 边框才不会糊
    const dpr = S.dpr || 1;
    const ln = 1 / dpr;
    const snap = (v) => Math.round(v * dpr) / dpr;
    const y = snap(y0);
    const yb = snap(y0 + bh);
    const hgt = yb - y;
    const outline = S.theme === 'dark' ? '#808080' : '#000000';

    if (!bands.length) {
      ctx.fillStyle = C.dim;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(0, y, w, hgt);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.border;
      ctx.lineWidth = ln;
      ctx.strokeRect(ln / 2, y + ln / 2, w - ln, hgt - ln);
      ctx.lineWidth = 1;
      return;
    }

    const center = y + hgt / 2;
    for (const [s, e, name, stain] of bands) {
      const a = snap(sx(s));
      const b = snap(sx(e));
      const bw = Math.max(ln, b - a);
      if (stain === 'acen') {
        const pArm = String(name || '').startsWith('p');
        ctx.beginPath();
        if (pArm) {
          ctx.moveTo(a, yb);
          ctx.lineTo(a, y);
          ctx.lineTo(b, center);
        } else {
          ctx.moveTo(b, yb);
          ctx.lineTo(b, y);
          ctx.lineTo(a, center);
        }
        ctx.closePath();
        ctx.fillStyle = '#b20000'; // Color.RED.darker()
        ctx.fill();
        continue;
      }
      const m = /^gpos(\d+)$/.exec(stain || '');
      const shade = m ? Math.round(255 - (Number(m[1]) / 100) * 255) : null;
      ctx.fillStyle = shade === null ? '#ffffff' : `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(a, y, bw, hgt);
      ctx.strokeStyle = outline;
      ctx.lineWidth = ln;
      ctx.strokeRect(a + ln / 2, y + ln / 2, Math.max(ln, bw - ln), hgt - ln);
    }
    ctx.lineWidth = 1;

    // 当前视图区间：IGV 的三层红色描边（只在放大时出现）
    const zx1 = sx(S.view.start), zx2 = sx(S.view.end);
    const zoomed = S.view.start > 0 || S.view.end < chromLen;
    if (zoomed) {
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 1;
      const span = Math.max(1, Math.round(zx2) - Math.round(zx1));
      for (let k = 0; k < 3; k++) {
        ctx.strokeRect(Math.round(zx1) - 0.5 - k, Math.round(y) + 0.5 - k, span + 2 * k, Math.round(hgt) - 1 + 2 * k);
      }
    }
  }

  function bandColor(stain, name) {
    // 仅供其它地方按单色引用；绘制走 drawIdeogram 里的 IGV 色板
    if (stain === 'acen') return '#b20000';
    const m = /^gpos(\d+)$/.exec(stain || '');
    if (m) {
      const v = Math.round(255 - (Number(m[1]) / 100) * 255);
      return `rgb(${v},${v},${v})`;
    }
    return '#ffffff';
  }

  /* ------------------------------------------------------------------- genes */
  const ROW_H = 22;

  function mergeIntervals(list) {
    if (!list.length) return [];
    const s = list.slice().sort((a, b) => a[0] - b[0]);
    const out = [s[0].slice()];
    for (let i = 1; i < s.length; i++) {
      const last = out[out.length - 1];
      if (s[i][0] <= last[1]) last[1] = Math.max(last[1], s[i][1]);
      else out.push(s[i].slice());
    }
    return out;
  }

  // 合并所有转录本的外显子 / CDS。纯函数（只依赖 gene 对象），缓存到 gene 上：
  // 整条染色体有 1800+ 基因，每帧重算 sort+merge 要几十毫秒
  const _geneModelCache = new WeakMap();
  function geneModel(gene) {
    const hit = _geneModelCache.get(gene);
    if (hit) return hit;
    const exons = [];
    const cds = [];
    for (const t of gene.tx) {
      for (const e of t.exons) exons.push(e);
      if (t.cdsEnd > t.cdsStart) cds.push([t.cdsStart, t.cdsEnd]);
    }
    const res = { exons: mergeIntervals(exons), cds: mergeIntervals(cds) };
    _geneModelCache.set(gene, res);
    return res;
  }

  function geneKey(g) { return `${g.name}|${g.chrom}`; }
  function isExpanded(g) {
    const k = geneKey(g);
    return S.expandAll ? !S.collapsed.has(k) : S.expanded.has(k);
  }
  function toggleExpand(g) {
    const k = geneKey(g);
    if (S.expandAll) {
      if (S.collapsed.has(k)) S.collapsed.delete(k); else S.collapsed.add(k);
    } else if (S.expanded.has(k)) {
      S.expanded.delete(k);
    } else {
      S.expanded.add(k);
    }
    savePrefs();
    renderInfo();
    scheduleRender();
  }

  /* 「一键展开」：RefSeq 用 S.expandAll，导入的 GTF 轨道按轨道 id 记在 S.loaded.expandAll */
  function expandAllOn(trackId) {
    return trackId ? S.loaded.expandAll.has(trackId) : S.expandAll;
  }

  function clearCollapsed(trackId) {
    if (!trackId) { S.collapsed.clear(); return; }
    const pre = `${trackId}|`;
    for (const k of [...S.loaded.collapsed]) if (k.startsWith(pre)) S.loaded.collapsed.delete(k);
  }

  function setExpandAll(trackId, on) {
    if (trackId) {
      if (on) S.loaded.expandAll.add(trackId); else S.loaded.expandAll.delete(trackId);
    } else {
      S.expandAll = !!on;
    }
    clearCollapsed(trackId);
    // 关掉时把逐个展开的记录也清空，避免「全部收起」之后还剩零散展开
    if (!on) {
      if (trackId) S.loaded.expanded.clear(); else S.expanded.clear();
    }
    scheduleRender();
  }

  /* 「折叠为一行」= IGV 基因轨道的 collapsed 模式（默认）：所有基因挤在第 0 行，
     重叠就重叠；「分行排布」= packed，重叠的基因逐行往上叠。导入的 GTF 轨道各自记
     在 S.loaded.pack 里（不在集合里 = 折叠）。 */
  function geneCollapsed(trackId) {
    return trackId ? !S.loaded.pack.has(trackId) : S.geneCollapsed !== false;
  }

  function setGeneCollapsed(trackId, on) {
    if (trackId) {
      if (on) S.loaded.pack.delete(trackId); else S.loaded.pack.add(trackId);
    } else {
      S.geneCollapsed = !!on;
    }
    // 折叠时把逐个展开的记录一起清掉，否则「折叠为一行」之后行数还是很多
    if (on) setExpandAll(trackId || null, false);
    savePrefs();
    scheduleRender();
  }

  // multi-row packing that honours expanded genes (each transcript = 1 row)
  function geneLayout() {
    const w = trackWidth();
    const bpPerPx = (S.view.end - S.view.start) / w;
    const showLabel = bpPerPx < 3000;
    const genes = S.data.genes.filter((g) => g.chrom === S.view.chrom
      && g.end > S.view.start && g.start < S.view.end);
    const rowsEnd = [];   // rightmost occupied x per row
    const rowsStart = []; // leftmost occupied x per row (labels may flip left)
    const placed = [];
    const collapsed = geneCollapsed(null);
    // 折叠模式下第 0 行留给「所有基因」，被展开的基因从第 1 行开始排
    if (collapsed) { rowsEnd.push(Infinity); rowsStart.push(-Infinity); }
    for (const g of genes.slice().sort((a, b) => a.start - b.start)) {
      const x1 = px(g.start);
      const x2 = px(g.end);
      const label = g.name || '';
      const txl = g.tx || [];
      const multi = txl.length > 1;
      const expanded = multi && isExpanded(g);

      // 折叠模式不画 +/−（一行里挤满了基因，按钮会压在别的基因上抢点击）；
      // 已经展开的基因仍然保留按钮，方便再收起来。
      let tgl = null;
      if (multi && (!collapsed || expanded)) {
        const TGL = 12, GAP = 4;
        const rx = Math.max(0, x2) + GAP;
        if (rx + TGL <= w - 2) tgl = { x: rx, w: TGL, h: TGL, left: false };
        else tgl = { x: Math.max(2, x1 - GAP - TGL), w: TGL, h: TGL, left: true };
      }

      // widest label this gene will draw (affects row packing / hit area)
      let lwText = label;
      if (expanded) {
        for (let i = 0; i < txl.length; i++) {
          const t = txl[i];
          const s = i === 0 ? `${label}  ·  ${t.name}` : `${t.name}`;
          if (s.length > lwText.length) lwText = s;
        }
      }
      const lw = showLabel ? Math.min(150, textWidth(lwText, GENE_FONT) + 8) : 0;
      // reserve the toggle lane so nothing is drawn on top of it
      const tglReserve = tgl && !tgl.left ? tgl.w + 8 : 0;
      const need = Math.max(x2, x1 + 3) + lw + tglReserve;
      const span = expanded ? txl.length : 1;
      // 折叠模式：没展开的基因一律放第 0 行，不参与排布（IGV 的 collapsed）
      if (collapsed && !expanded) {
        placed.push({ g, x1, x2, r: 0, span: 1, label, lw, need, tgl, expanded: false, txl });
        continue;
      }
      // a left-side toggle needs clearance from the previous gene in the row
      const minGap = tgl && tgl.left ? 18 : 6;
      // Clamp the threshold at 0: a gene that starts left of the viewport has
      // x1 < 0, so `x1 - minGap` is negative. A fresh row's rowsEnd is 0, and
      // `0 > negative` is always true -> r++ forever -> rowsEnd grows without
      // bound until RangeError("Invalid array length") freezes/crashes the page.
      // An empty row must always be placeable, so threshold is never negative.
      const rowLimit = Math.max(0, x1 - minGap);
      let r = 0;
      let guard = 0;
      while (true) {
        while (rowsEnd.length < r + span) { rowsEnd.push(0); rowsStart.push(1e9); }
        let conflict = false;
        for (let k = 0; k < span; k++) {
          if (rowsEnd[r + k] > rowLimit) { conflict = true; break; }
        }
        if (!conflict) break;
        r++;
        if (++guard > 20000) break; // safety net, not expected to trigger
      }
      while (rowsEnd.length < r + span) { rowsEnd.push(0); rowsStart.push(1e9); }
      for (let k = 0; k < span; k++) {
        rowsEnd[r + k] = need;
        rowsStart[r + k] = Math.min(rowsStart[r + k], x1 - (tgl && tgl.left ? minGap : 0));
      }
      placed.push({ g, x1, x2, r, span, label, lw, need, tgl, expanded, txl });
    }
    const maxRows = Math.max(1, Math.min(rowsEnd.length, 80));
    return { placed, rowsEnd, rowsStart, maxRows, showLabel, w, bpPerPx, count: genes.length };
  }

  // measure text width without needing a live ctx
  let _measureCtx = null;
  const GENE_FONT = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
  // 3′ 端方向箭头探出特征末端的长度（见 drawStrandArrow）；排标签时也要让开这么多，
  // 否则基因名会正好压住箭头尖
  const ARROW_PAD = 8;
  // 文本宽度缓存：命中测试要在每次 mousemove 里重算整屏标签几何，
  // 不缓存的话 fitText 的逐字符截断会量上千次 measureText。
  const _twCache = new Map();
  function textWidth(text, font) {
    const f = font || GENE_FONT;
    const key = f + '\u0000' + text;
    const hit = _twCache.get(key);
    if (hit !== undefined) return hit;
    if (!_measureCtx) {
      const c = document.createElement('canvas');
      _measureCtx = c.getContext('2d');
    }
    _measureCtx.font = f;
    const v = _measureCtx.measureText(text).width;
    if (_twCache.size > 6000) _twCache.clear();
    _twCache.set(key, v);
    return v;
  }

  // shrink text with an ellipsis until it fits in avail px; null if even 1 char won't fit
  function fitText(text, avail) {
    if (avail <= 6) return null;
    const tw = textWidth(text, GENE_FONT);
    if (tw <= avail) return { text, tw };
    let s = text;
    while (s.length > 1) {
      s = s.slice(0, -1);
      const t2 = textWidth(s + '…', GENE_FONT);
      if (t2 <= avail) return { text: s + '…', tw: t2 };
    }
    return null;
  }

  // Where may a gene label be drawn? Returns a clip region; the text is truncated
  // with an ellipsis to fit it. null when there is no usable room.
  //  - toggle on the right of the feature: label goes after the toggle.
  //  - toggle in the left gutter: label goes right of the feature, else right-aligned
  //    just left of the toggle.
  //  - no toggle: label goes right of xRight, else right-aligned left of xLeft.
  // occ: 本行已经放过的标签 [x0,x1]。一行里并排放着好几个基因时，不把可用区间
  // 夹到前一个标签的左边界，后画的标签就会压上去（BRCA1 / BRCA2 叠成糊字）。
  function labelRegion(xRight, xLeft, tgl, w, occ) {
    const rightClip = w - 2;
    const nextStart = (from) => {
      let e = rightClip;
      if (occ) for (const iv of occ) if (iv[0] > from && iv[0] - 6 < e) e = iv[0] - 6;
      return e;
    };
    const prevEnd = (to) => {
      let s = 2;
      if (occ) for (const iv of occ) if (iv[1] < to && iv[1] + 6 > s) s = iv[1] + 6;
      return s;
    };
    if (tgl && !tgl.left) {
      const l = tgl.x + tgl.w + 4;
      const e = nextStart(l);
      if (e - l >= 12) return { clipLeft: l, clipRight: e, rightAlign: false };
      const r = xLeft - 3;
      const s = prevEnd(r);
      if (r - s >= 12) return { clipLeft: s, clipRight: r, rightAlign: true };
      return null;
    }
    if (xRight + 6 + ARROW_PAD < rightClip - 12) {
      const l = xRight + 4 + ARROW_PAD;
      const e = nextStart(l);
      if (e - l >= 12) return { clipLeft: l, clipRight: e, rightAlign: false };
    }
    const r = tgl ? tgl.x - 3 : xLeft - 3 - ARROW_PAD;
    const s = prevEnd(r);
    if (r - s >= 12) return { clipLeft: s, clipRight: r, rightAlign: true };
    return null;
  }

  // Resolve where a gene/transcript name is drawn. Shared by the renderer and
  // the hit tester, so clicking a name always selects the right feature.
  //  1. free margin left of the feature   2. free space right of the feature
  //  3. plated over the feature on a translucent background
  // marginLeft : first usable x of the free margin left of the feature
  // featX1/X2  : feature extent
  // rightX     : first usable x on the right side of the feature
  function geneLabelSpot(text, o) {
    const w = o.w;
    const tw = textWidth(text, GENE_FONT);
    const lo = o.marginLeft;
    const hi = o.featX1 - 3;
    if (hi - lo >= tw + 2) return { x: lo, tw, text };
    const rx = o.rightX;
    if (w - 2 - rx >= tw + 2) return { x: rx, tw, text };
    const fit = fitText(text, Math.max(24, Math.min(w - lo - 2, 240)));
    if (!fit) return null;
    const x = Math.max(2, Math.min(lo, w - fit.tw - 2));
    return { x, tw: fit.tw, text: fit.text, plated: true };
  }

  function drawGeneText(ctx, text, color, cy, o) {
    const spot = geneLabelSpot(text, o);
    if (!spot) return;
    if (spot.plated) {
      ctx.save();
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = C.bg;
      ctx.fillRect(spot.x - 2, cy - 8, spot.tw + 4, 16);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = color;
    ctx.fillText(spot.text, spot.x, cy + 0.5);
    if (spot.plated) ctx.restore();
  }

  function drawBackbone(ctx, x1, x2, cy, color, w) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.max(0, x1), cy);
    ctx.lineTo(Math.min(w, x2), cy);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* sRGB 相对亮度：用来给「叠在色块上的方向符号」挑一个看得清的墨色。
     色块颜色用户可配（CDS 在浅色主题下近乎纯黑、深色主题下近乎纯白），
     写死一种颜色必然有一种主题看不见。 */
  function hexLum(hex) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    let s = m[1];
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const r = lin(parseInt(s.slice(0, 2), 16) / 255);
    const g = lin(parseInt(s.slice(2, 4), 16) / 255);
    const b = lin(parseInt(s.slice(4, 6), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // 在 fill 上画符号时用的墨色：按 WCAG 对比度（而不是亮度差）在画布底色 / 正文色里挑，
  // 否则中等亮度的 UTR 灰（#a6afb9）会选中白色，浅灰底 + 白符号几乎看不见。
  // 结果缓存：一条轨道上只有 3~4 种填充色，但外显子片段可能有上千个，别每次都算 pow()。
  const _inkCache = new Map();
  function inkOn(fill) {
    const key = S.theme + '|' + (fill || '');
    const hit = _inkCache.get(key);
    if (hit !== undefined) return hit;
    const l = hexLum(fill);
    const lb = hexLum(C.bg);
    const lt = hexLum(C.text);
    let res;
    if (l == null || lb == null || lt == null) {
      res = C.bg;
    } else {
      const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      res = ratio(l, lb) >= ratio(l, lt) ? C.bg : C.text;
    }
    _inkCache.set(key, res);
    return res;
  }

  /* 转录方向雪佛龙（»）。必须画在外显子块「之后」：CDS 块高 12px、UTR 块高 7px，
     都盖得住 cy±3 的雪佛龙 —— 画在前面等于没画（JUNB 这种单外显子基因完全看不到方向）。
     segs 是 drawExons 的返回值，用来知道当前位置压在哪种色块上，好换对比色。 */
  function drawChevrons(ctx, x1, x2, cy, color, w, dir, segs) {
    if (x2 - x1 <= 26) return;
    // 用传进来的 w 换算，别再调 trackWidth()：那里面是 querySelector + clientWidth，
    // 每个基因调一次 = 每个基因一次布局查询，密集区域会明显拖慢渲染
    const bpp = (S.view.end - S.view.start) / w;
    const inkAt = (x) => {
      if (!segs || !segs.length) return null;
      const bp = S.view.start + x * bpp;
      for (let i = 0; i < segs.length; i++) {
        if (bp >= segs[i].s && bp < segs[i].e) return segs[i].ink;
      }
      return null;
    };
    for (let x = Math.max(6, x1 + 10); x < Math.min(w - 4, x2 - 8); x += 34) {
      const ink = inkAt(x);
      ctx.fillStyle = ink || color;
      ctx.globalAlpha = ink ? 0.95 : 0.6;
      ctx.beginPath();
      ctx.moveTo(x - 3 * dir, cy - 3);
      ctx.lineTo(x + 3 * dir, cy);
      ctx.lineTo(x - 3 * dir, cy + 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 返回画出来的片段 [{s,e,ink}]，给 drawChevrons 挑墨色用
  function drawExons(ctx, exons, cds, cy, color, pal) {
    // non-coding transcripts have no CDS: every exon is exonic but none is UTR
    // in the coding sense, so they keep the strand colour
    const coding = cds.length > 0;
    const cdsColor = (pal && pal.cds) || C.cds || C.text;
    const utrColor = (pal && pal.utr) || C.utr || C.muted;
    // 墨色只在「本次渲染的调色板」上算一次：整条染色体 1800+ 基因时，
    // 每个片段都算一遍 hexLum/对比度会白烧十几毫秒
    if (pal && !pal._ink) pal._ink = { cds: inkOn(cdsColor), utr: inkOn(utrColor), other: new Map() };
    const inkSet = pal && pal._ink;
    const inkOther = (fill) => {
      if (!inkSet) return inkOn(fill);
      let v = inkSet.other.get(fill);
      if (v === undefined) { v = inkOn(fill); inkSet.other.set(fill, v); }
      return v;
    };

    // 快路径：整个特征只有 1~2 px（缩到整条染色体时几乎所有基因都这样），
    // 没必要拆 CDS/UTR，直接按链色铺一格
    const spanPx = exons.length ? px(exons[exons.length - 1][1]) - px(exons[0][0]) : 0;
    if (spanPx < 3) {
      ctx.fillStyle = coding ? cdsColor : color;
      ctx.globalAlpha = 1;
      for (const [es, ee] of exons) {
        if (ee <= es) continue;
        const sx = px(es);
        ctx.fillRect(sx, cy - 3, Math.max(1.2, px(ee) - sx), 6);
      }
      ctx.globalAlpha = 1;
      return [];
    }

    const segs = [];
    for (const [es, ee] of exons) {
      let segments = [[es, ee, false]];
      for (const [cs, ce] of cds) {
        if (ce <= es || cs >= ee) continue;
        const parts = [];
        for (const [s0, e0, flag] of segments) {
          if (flag) { parts.push([s0, e0, true]); continue; }
          if (ce <= s0 || cs >= e0) { parts.push([s0, e0, false]); continue; }
          if (cs > s0) parts.push([s0, cs, false]);
          parts.push([Math.max(s0, cs), Math.min(e0, ce), true]);
          if (ce < e0) parts.push([ce, e0, false]);
        }
        segments = parts;
      }
      for (const [s0, e0, isCds] of segments) {
        if (e0 <= s0) continue;
        const sx = px(s0);
        const sw = Math.max(1.2, px(e0) - sx);
        const eh = isCds ? 12 : 7;
        // CDS (coding) vs UTR — colours are user-configurable
        let ink;
        if (isCds) {
          ctx.fillStyle = cdsColor;
          ctx.globalAlpha = 1;
          ink = inkSet ? inkSet.cds : inkOn(cdsColor);
        } else if (coding) {
          ctx.fillStyle = utrColor;
          ctx.globalAlpha = 1;
          ink = inkSet ? inkSet.utr : inkOn(utrColor);
        } else {
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.6;
          ink = inkOther(color);
        }
        ctx.fillRect(sx, cy - eh / 2, sw, eh);
        ctx.globalAlpha = 1;
        segs.push({ s: s0, e: e0, ink });
      }
    }
    return segs;
  }

  function drawGenes() {
    if (!S._geneToggles) S._geneToggles = [];
    S._geneToggles.length = 0;
    const canvas = paneCanvas('.track[data-track="genes"]');
    const { placed, maxRows, showLabel, w, count } = geneLayout();
    const h = maxRows * ROW_H + 10;
    const { ctx } = fitCanvas(canvas, h);

    $('#geneCount').textContent = count
      ? T(`${count}${S.data.truncated ? '+' : ''} 个基因`) : T('无');

    if (!count) {
      ctx.fillStyle = C.muted;
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(S.asm.hasGenes ? T('此区域无基因注释') : T('该版本未内置基因注释'), 12, h / 2);
      return;
    }

    ctx.textBaseline = 'middle';
    const pal = geneTint(null);
    // 每行一个标签占位表：密集区域一行里会并排放好几个基因，标签必须互相避让
    const occByRow = new Map();
    const occFor = (r) => {
      let a = occByRow.get(r);
      if (!a) occByRow.set(r, a = []);
      return a;
    };
    for (const p of placed) {
      if (p.r >= maxRows) continue;
      const { g, x1, x2, r, span } = p;
      const color = strandColor(pal, g.strand);
      const selected = S.sel && S.sel.name === g.name && S.sel.chrom === g.chrom;
      const expanded = p.expanded;

      // feature rows
      // 顺序：骨架 → 外显子块 → 方向雪佛龙 → 3′ 端箭头。
      // 雪佛龙和箭头必须压在块上面，否则被 CDS（12px）/UTR（7px）块盖掉。
      const dir = g.strand === '-' ? -1 : 1;
      if (expanded) {
        // each transcript on its own row, drawn with its own coordinates
        for (let i = 0; i < span; i++) {
          if (r + i >= maxRows) break;
          const t = p.txl[i];
          const cy = 6 + (r + i) * ROW_H + ROW_H / 2;
          const tx1 = px(t.start);
          const tx2 = px(t.end);
          const cds = (t.cdsEnd > t.cdsStart) ? [[t.cdsStart, t.cdsEnd]] : [];
          drawBackbone(ctx, tx1, tx2, cy, color, w);
          const segs = drawExons(ctx, t.exons, cds, cy, color, pal);
          drawChevrons(ctx, tx1, tx2, cy, color, w, dir, segs);
          drawStrandArrow(ctx, tx1, tx2, cy, color, w, dir);
        }
      } else {
        const cy = 6 + r * ROW_H + ROW_H / 2;
        const model = geneModel(g);
        drawBackbone(ctx, x1, x2, cy, color, w);
        const segs = drawExons(ctx, model.exons, model.cds, cy, color, pal);
        drawChevrons(ctx, x1, x2, cy, color, w, dir, segs);
        drawStrandArrow(ctx, x1, x2, cy, color, w, dir);
      }

      // selection rectangle around the whole gene (all rows)
      if (selected) {
        const bx = Math.max(0, x1 - 1);
        const bxe = Math.min(w, x2 + 1);
        if (bxe > bx) {
          const top = 6 + r * ROW_H - 2;
          const boxH = span * ROW_H + 4;
          ctx.fillStyle = C.accent;
          ctx.globalAlpha = 0.10;
          ctx.fillRect(bx, top, bxe - bx, boxH);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = C.accent;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(bx + 0.5, top + 0.5, bxe - bx - 1, boxH - 1);
          ctx.lineWidth = 1;
        }
      }

      // labels
      if (showLabel) {
        ctx.font = GENE_FONT;
        if (expanded) {
          for (let i = 0; i < span; i++) {
            if (r + i >= maxRows) break;
            const t = p.txl[i];
            const cy = 6 + (r + i) * ROW_H + ROW_H / 2;
            const text = (i === 0) ? `${g.name}  ·  ${t.name}` : `${t.name}`;
            const color = (i === 0 && selected) ? C.accent : (i === 0 ? C.text : C.dim);
            // transcript name sits next to its own transcript (right of it when
            // there is room, else just left), matching the imported GTF track
            const spot = rowLabelSpot(text, {
              x1: px(t.start), x2: px(t.end), w, tgl: i === 0 ? p.tgl : null,
              occ: occFor(r + i),
            });
            if (spot) {
              drawRowLabel(ctx, spot, text, color, cy, w);
              occFor(r + i).push([spot.x, spot.x + spot.tw]);
            }
          }
        } else {
          const cy = 6 + r * ROW_H + ROW_H / 2;
          ctx.fillStyle = selected ? C.accent : C.text;
          const occ = occFor(r);
          const reg = labelRegion(x2, x1, p.tgl, w, occ);
          if (reg) {
            const fit = fitText(p.label, reg.clipRight - reg.clipLeft);
            if (fit) {
              const lx = reg.rightAlign ? reg.clipRight - fit.tw : reg.clipLeft;
              occ.push([lx, lx + fit.tw]);
              ctx.save();
              ctx.beginPath();
              ctx.rect(reg.clipLeft, cy - 10, reg.clipRight - reg.clipLeft, 20);
              ctx.clip();
              ctx.fillText(fit.text, lx, cy + 0.5);
              ctx.restore();
            }
          }
        }
      }

      // expand / collapse toggle for multi-transcript genes
      if (p.tgl) {
        const cy0 = 6 + r * ROW_H + ROW_H / 2;
        const txx = p.tgl.x;
        const tyy = cy0 - p.tgl.h / 2;
        const tsz = p.tgl.w;
        ctx.fillStyle = selected ? C.accent : C.muted;
        ctx.globalAlpha = 0.92;
        ctx.strokeStyle = selected ? C.accent : C.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(txx + 0.5, tyy + 0.5, tsz, tsz);
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(expanded ? '−' : '+', txx + tsz / 2, cy0 + 0.5);
        ctx.textAlign = 'left';
        S._geneToggles.push({ x: txx, y: tyy, w: tsz, h: p.tgl.h, key: geneKey(g) });
      }
    }

    if (S.data.truncated) {
      ctx.fillStyle = C.muted;
      ctx.font = '10.5px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(T(`仅显示前 ${fmt(count)} 个基因，请放大查看`), w - 8, 10);
      ctx.textAlign = 'left';
    }
  }

  /* ---------------------------------------------------------------------- GC */
  function drawGC() {
    const canvas = paneCanvas('.track[data-track="gc"]');
    const { ctx, w, h } = fitCanvas(canvas, 52);
    const gc = S.data.gc;
    if (!S.asm.hasSeq) {
      ctx.fillStyle = C.muted;
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(T('该版本未内置序列文件'), 12, h / 2);
      return;
    }
    if (!gc || !S.data.gcRange) {
      ctx.fillStyle = C.muted;
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(T('计算中…'), 12, h / 2);
      return;
    }
    const r = S.data.gcRange;
    const n = gc.length;
    const step = (r.end - r.start) / n;
    const y0 = 6, y1 = h - 8;
    const yOf = (v) => y1 - ((clamp(v, 0.3, 0.7) - 0.3) / 0.4) * (y1 - y0);

    // GC 轴：只画 50% 一条淡参考线。
    // 原来 30/50/70 三条线 + 右侧百分比标签，在 52 px 高的轨道里挤成一片很乱；
    // 30–70% 的范围左侧标签列已经写着（index.html 的 .sub），画布上不必重复。
    const yMid = Math.round(yOf(0.5)) + 0.5;
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    ctx.moveTo(0, yMid);
    ctx.lineTo(w, yMid);
    ctx.stroke();

    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const x = px(r.start + i * step);
      if (x < -2 || x > w + 2) continue;
      const v = gc[i];
      if (v == null) { started = false; continue; }
      if (!started) { ctx.moveTo(x, yOf(v)); started = true; }
      else ctx.lineTo(x, yOf(v));
    }
    ctx.strokeStyle = S.tint.gc || '#7d8b9c';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  /* --------------------------------------------------------------------- seq */
  const BASE_COLORS = {
    A: '#3f8f5f', C: '#3f6fb0', G: '#b8802f', T: '#b85c4f', U: '#b85c4f', N: '#9aa5b1',
  };

  /* 碱基互补表（含 IUPAC 简并码），对应 IGV SequenceTrack.getReverseComplement
     与 SequenceRenderer 里的 complementChar：负链不是把序列倒过来，而是逐位取互补
     —— x 轴永远是基因组正方向，所以左→右读出来就是负链的 3′→5′。 */
  const COMPLEMENT = {
    A: 'T', T: 'A', G: 'C', C: 'G', U: 'A', N: 'N',
    R: 'Y', Y: 'R', M: 'K', K: 'M', S: 'S', W: 'W',
    B: 'V', V: 'B', D: 'H', H: 'D',
  };

  function complementBase(c) {
    const up = c.toUpperCase();
    const r = COMPLEMENT[up];
    if (!r) return c;
    return c === up ? r : r.toLowerCase();
  }

  /* ------------------------------------------- 遗传密码表（NCBI transl_table） */
  // 与 IGV 的 Translation Table 菜单同源：都是 NCBI genetic code。
  // 碱基 1/2/3 位都按 T,C,A,G 排列，拼出 64 个密码子；标准表用 NCBI 的 64 字母串，
  // 其余表只记与标准表的差异（密码子 → 氨基酸），比逐表抄 64 个字母不容易错。
  const CODON_KEYS = (() => {
    const B = ['T', 'C', 'A', 'G'];
    const out = [];
    for (const a of B) for (const b of B) for (const c of B) out.push(a + b + c);
    return out;
  })();
  const STANDARD_AA = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';

  const GENETIC_TABLES = [
    { id: 1, name: 'Standard', cn: T('标准'), species: T('通用（默认）') },
    { id: 2, name: 'Vertebrate Mitochondrial', cn: T('脊椎动物线粒体'), species: T('脊椎动物'),
      over: [['AGA', '*'], ['AGG', '*'], ['ATA', 'M'], ['TGA', 'W']] },
    { id: 3, name: 'Yeast Mitochondrial', cn: T('酵母线粒体'), species: T('酿酒酵母等'),
      over: [['ATA', 'M'], ['CTA', 'T'], ['CTC', 'T'], ['CTG', 'T'], ['CTT', 'T'], ['TGA', 'W']] },
    { id: 4, name: 'Mold / Protozoan / Coelenterate Mitochondrial; Mycoplasma; Spiroplasma',
      cn: T('霉菌·原生动物·腔肠动物线粒体；支原体；螺旋体'), species: T('多种'),
      over: [['TGA', 'W']] },
    { id: 5, name: 'Invertebrate Mitochondrial', cn: T('无脊椎动物线粒体'), species: T('果蝇等'),
      over: [['AGA', 'S'], ['AGG', 'S'], ['ATA', 'M'], ['TGA', 'W']] },
    { id: 6, name: 'Ciliate / Dasycladacean / Hexamita Nuclear', cn: T('纤毛虫·绒枝藻·六鞭毛虫核'),
      species: T('四膜虫等'), over: [['TAA', 'Q'], ['TAG', 'Q']] },
    { id: 9, name: 'Echinoderm / Flatworm Mitochondrial', cn: T('棘皮动物·扁形动物线粒体'), species: T('海胆、涡虫等'),
      over: [['AAA', 'N'], ['AGA', 'S'], ['AGG', 'S'], ['TGA', 'W']] },
    { id: 10, name: 'Euplotid Nuclear', cn: T('游仆虫核'), species: 'Euplotes',
      over: [['TGA', 'C']] },
    { id: 11, name: 'Bacterial, Archaeal and Plant Plastid', cn: T('细菌·古菌·植物质体'), species: T('大肠杆菌、叶绿体等') },
    { id: 12, name: 'Alternative Yeast Nuclear', cn: T('替代酵母核'), species: T('假丝酵母等'),
      over: [['CTG', 'S']] },
    { id: 13, name: 'Ascidian Mitochondrial', cn: T('海鞘线粒体'), species: T('海鞘'),
      over: [['AGA', 'G'], ['AGG', 'G'], ['ATA', 'M'], ['TGA', 'W']] },
    { id: 14, name: 'Alternative Flatworm Mitochondrial', cn: T('替代扁形动物线粒体'), species: T('扁形动物'),
      over: [['AAA', 'N'], ['AGA', 'S'], ['AGG', 'S'], ['TAA', 'Y'], ['TGA', 'W']] },
    { id: 15, name: 'Blepharisma Macronuclear', cn: T('赭纤虫大核'), species: 'Blepharisma',
      over: [['TAG', 'Q']] },
    { id: 16, name: 'Chlorophycean Mitochondrial', cn: T('绿藻线粒体'), species: T('绿藻'),
      over: [['TAG', 'L']] },
    { id: 21, name: 'Trematode Mitochondrial', cn: T('吸虫线粒体'), species: T('血吸虫等'),
      over: [['AAA', 'N'], ['AGA', 'S'], ['AGG', 'S'], ['ATA', 'M'], ['TGA', 'W']] },
    { id: 22, name: 'Scenedesmus obliquus Mitochondrial', cn: T('斜生栅藻线粒体'), species: T('斜生栅藻'),
      over: [['TCA', '*'], ['TAG', 'L']] },
    { id: 23, name: 'Thraustochytrium Mitochondrial', cn: T('破囊壶菌线粒体'), species: 'Thraustochytrium',
      over: [['TTA', '*']] },
    { id: 24, name: 'Pterobranchia Mitochondrial', cn: T('翼鳃类线粒体'), species: T('翼鳃类'),
      over: [['AGA', 'S'], ['AGG', 'K'], ['TGA', 'W']] },
    { id: 25, name: 'Candidate Division SR1 and Gracilibacteria', cn: T('候选门 SR1 与 Gracilibacteria'), species: T('细菌'),
      over: [['TGA', 'G']] },
    { id: 26, name: 'Pachysolen tannophilus Nuclear', cn: T('嗜鞣管囊酵母核'), species: 'Pachysolen',
      over: [['CTG', 'A']] },
    { id: 27, name: 'Karyorelict Nuclear', cn: T('核残迹虫核'), species: 'Karyorelict',
      over: [['TAA', 'Q'], ['TAG', 'Q'], ['TGA', 'W']] },
    { id: 28, name: 'Condylostoma Nuclear', cn: T('齿口虫核'), species: 'Condylostoma',
      over: [['TAA', 'Q'], ['TAG', 'Q'], ['TGA', 'W']] },
    { id: 29, name: 'Mesodinium Nuclear', cn: T('中缢虫核'), species: 'Mesodinium',
      over: [['TAA', 'Y'], ['TAG', 'Y']] },
    { id: 30, name: 'Peritrich Nuclear', cn: T('缘毛虫核'), species: T('缘毛虫'),
      over: [['TAA', 'E'], ['TAG', 'E']] },
    { id: 31, name: 'Blastocrithidia Nuclear', cn: T('芽生短膜虫核'), species: 'Blastocrithidia',
      over: [['TAA', 'E'], ['TAG', 'E']] },
    { id: 32, name: 'Balanophoraceae Plastid', cn: T('蛇菰科质体'), species: T('蛇菰科'),
      over: [['TAG', 'W']] },
    { id: 33, name: 'Cephalodiscidae Mitochondrial', cn: T('头盘虫科线粒体'), species: T('头盘虫科'),
      over: [['TAA', 'Y'], ['TAG', 'L'], ['AGA', 'S'], ['AGG', 'K'], ['TGA', 'W']] },
  ];

  const _codeCache = new Map();
  function geneticCode(id) {
    let c = _codeCache.get(id);
    if (c) return c;
    const t = GENETIC_TABLES.find((x) => x.id === id) || GENETIC_TABLES[0];
    const aa = Object.create(null);
    CODON_KEYS.forEach((k, i) => { aa[k] = STANDARD_AA[i]; });
    for (const [codon, letter] of (t.over || [])) aa[codon] = letter;
    c = { id: t.id, name: t.name, cn: t.cn, species: t.species, aa };
    _codeCache.set(id, c);
    return c;
  }

  function tableLabel(t) {
    return `#${t.id} ${t.cn}`;
  }

  // 翻译开关/密码表都是**按轨道**的：key = 'seq'（内置 RefSeq 序列轨道）
  // 或导入序列轨道的 track id。两条轨道互不影响（之前是全局单例，点一个全开）。
  function transOnFor(key) {
    if (key === 'seq') return !!S.trans.on;
    return S.trans.loaded.has(key);
  }

  function transTableFor(key) {
    if (key === 'seq') return S.trans.table;
    const v = S.trans.loadedTable[key];
    return Number.isFinite(v) ? v : S.trans.table;
  }

  function setTrans(key, on) {
    if (key === 'seq') S.trans.on = !!on;
    else if (on) S.trans.loaded.add(key);
    else S.trans.loaded.delete(key);
    savePrefs();
    syncTransButtons();
    scheduleRender();
  }

  function setSeqTrans(on) {
    setTrans('seq', on);
  }

  // 导入序列轨道的翻译开关（与内置序列轨道各自独立）
  function setLoadedTrans(tid, on) {
    setTrans(tid, on);
  }

  function setTransTable(id, key) {
    const t = GENETIC_TABLES.find((x) => x.id === Number(id));
    if (!t) return;
    if (!key || key === 'seq') S.trans.table = t.id;
    else S.trans.loadedTable[key] = t.id;
    savePrefs();
    syncTransButtons();
    scheduleRender();
  }

  function syncTransButtons() {
    for (const b of $$('.sflip[data-trans]')) {
      const key = b.dataset.transid || 'seq';
      const on = transOnFor(key);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.title = on
        ? T(`氨基酸翻译：开（${tableLabel(geneticCode(transTableFor(key)))}）`)
        : T('显示氨基酸翻译');
    }
  }

  // 「Aa」按钮的弹层：显示翻译 + 遗传密码表（对应 IGV 的 Show translation / Translation Table）
  function closeTransPop() {
    const p = $('#transPop');
    if (p) p.hidden = true;
  }

  function openTransPop(anchor, key) {
    const pop = $('#transPop');
    if (!pop) return;
    const tkey = key || 'seq';
    pop.dataset.key = tkey;   // 记住这个弹层是给哪条轨道的，再点同一个按钮就收起
    pop.innerHTML = '';

    const h5 = document.createElement('h5');
    h5.textContent = T('氨基酸翻译');
    pop.appendChild(h5);

    const rowOn = document.createElement('div');
    rowOn.className = 'row tight';
    const lab = document.createElement('label');
    lab.className = 'lbl';
    lab.style.display = 'flex';
    lab.style.alignItems = 'center';
    lab.style.gap = '6px';
    lab.style.cursor = 'pointer';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'transOn';
    cb.checked = transOnFor(tkey);
    cb.onchange = () => setTrans(tkey, cb.checked);
    const cbTxt = document.createElement('span');
    cbTxt.textContent = T('显示翻译');
    lab.append(cb, cbTxt);
    rowOn.appendChild(lab);
    pop.appendChild(rowOn);

    const rowT = document.createElement('div');
    rowT.className = 'row';
    const l2 = document.createElement('span');
    l2.className = 'lbl';
    l2.textContent = T('翻译表');
    const sel = document.createElement('select');
    sel.id = 'transTable';
    for (const t of GENETIC_TABLES) {
      const o = document.createElement('option');
      o.value = String(t.id);
      o.textContent = `#${t.id} ${t.cn}`;
      o.title = `${t.name} — ${t.species}`;
      if (t.id === transTableFor(tkey)) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => {
      setTransTable(sel.value, tkey);
      hint.textContent = codeHint(tkey);
    };
    rowT.append(l2, sel);
    pop.appendChild(rowT);

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = codeHint(tkey);
    pop.appendChild(hint);

    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = r.right + 10;
    if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - 10);
    let top = r.top - 2;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function codeHint(key) {
    const c = geneticCode(transTableFor(key || 'seq'));
    return T(`${c.name} — ${c.species}。三行分别是 3 个读码框（密码子按基因组坐标每 3 bp 划分）；`)
      + T(`点轨道上的 ⇄ 翻转后按互补链翻译。需放大到约 0.33 bp/px 以上才显示。`);
  }

  function setSeqFlip(v) {
    S.seqFlip = !!v;
    const b = $('#seqFlip');
    if (b) b.setAttribute('aria-pressed', S.seqFlip ? 'true' : 'false');
    savePrefs();
    scheduleRender();
  }

  // 与 #seqFlip 同一套图形，导入的 FASTA 轨道复用
  const SEQ_FLIP_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true">'
    + '<path d="M2.6 5.1h10.2M10.6 3.1l2.2 2-2.2 2" fill="none" stroke="currentColor"'
    + ' stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M13.4 10.9H3.2M5.4 8.9l-2.2 2 2.2 2" fill="none" stroke="currentColor"'
    + ' stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // 导入序列轨道各自的 flip 状态（按轨道 id，互不影响）
  function loadedSeqFlipped(t) {
    return !!(t && S.loaded.flip.has(t.id));
  }

  function setLoadedSeqFlip(tid, v) {
    if (v) S.loaded.flip.add(tid); else S.loaded.flip.delete(tid);
    for (const b of $$(`.sflip[data-seqflip="${CSS.escape(tid)}"]`)) {
      b.setAttribute('aria-pressed', v ? 'true' : 'false');
    }
    savePrefs();
    scheduleRender();
  }

  // 氨基酸翻译：IGV 式的**三行**，每行一个读码框（frame 0 / 1 / 2）。
  // 密码子按**基因组绝对坐标**每 3 bp 划分（frame f 的密码子是 [3k+f, 3k+f+3)），
  // 所以左右平移时氨基酸不漂移、三行的上下顺序也永远不变。
  // flip（互补链）时密码子取反向互补，阅读方向跟着变成 5′←3′。
  const AA_BAND_H = 14;                     // 每行高（IGV: HEIGHT_PER_BAND = 14）
  const AA_ROWS = 3;
  const AA_H = AA_BAND_H * AA_ROWS;
  // 灰色深度：三行各用一档灰，行内再按密码子明暗交替。
  // IGV 是 128/170 两档交替；这里把三行铺在 84~170 这个区间上，
  // 同一列上下扫一眼就能分清哪行是哪个读码框，字母（白字）也还看得清。
  const AA_BG_BASE = 84;    // 第一行（frame 0）最暗
  const AA_BG_ROW = 32;     // 每往下一行提亮一档
  const AA_BG_ALT = 22;     // 同一行内相邻密码子的明暗差
  const AA_STOP = '#d9534f';
  const AA_START = '#3fa34d';

  function drawAminoAcids(ctx, seq, seqStart, w, cellW, top, flip, tableId) {
    const code = geneticCode(Number.isFinite(tableId) ? tableId : S.trans.table);
    const bandH = AA_BAND_H;
    const fs = Math.min(11, Math.max(7, bandH - 5));
    const drawLetter = cellW * 3 >= 7;
    const seqEnd = seqStart + seq.length;
    const baseAt = (pos) => {
      const i = pos - seqStart;
      if (i < 0 || i >= seq.length) return 'N';
      const c = seq[i].toUpperCase();
      return flip ? complementBase(c) : c;
    };
    ctx.font = `600 ${fs}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cuts = [];   // [x, y]：每个读码框自己的密码子边界（三行的边界位置互不相同）

    for (let f = 0; f < AA_ROWS; f++) {
      const y = top + f * bandH;
      // 从视野左侧再往前退一个密码子，保证左边缘的半截密码子也画出来
      for (let cs = Math.floor(seqStart / 3) * 3 + f - 3; cs < seqEnd + 3; cs += 3) {
        const x0 = px(cs);
        const x1 = px(cs + 3);
        if (x1 < -2) continue;
        if (x0 > w + 2) break;
        // 阅读方向上的密码子：+ 链取 [cs, cs+3)，− 链取它的反向互补
        const codon = flip
          ? baseAt(cs + 2) + baseAt(cs + 1) + baseAt(cs)
          : baseAt(cs) + baseAt(cs + 1) + baseAt(cs + 2);
        const aa = code.aa[codon] || 'X';
        const stop = aa === '*';
        const start = codon === 'ATG';
        const bw = Math.max(1, x1 - x0);
        if (stop || start) {
          ctx.fillStyle = stop ? AA_STOP : AA_START;
        } else {
          const lv = AA_BG_BASE + f * AA_BG_ROW + (((cs / 3) & 1) ? AA_BG_ALT : 0);
          ctx.fillStyle = `rgb(${lv},${lv},${lv})`;
        }
        ctx.fillRect(x0, y, bw, bandH);
        if (drawLetter && bw >= 5) {
          ctx.fillStyle = '#fff';
          ctx.fillText(stop ? '*' : aa, (x0 + x1) / 2, y + bandH / 2 + 0.5);
        }
        cuts.push([Math.round(x1), y]);
      }
    }

    // 密码子边界实线：**只在各自那一行内**画。
    // 三行的读码框错开 1 bp，若跨行通画，每行的格子都会被别行的边界切碎。
    if (drawLetter && cellW * 3 >= 2.5 * fs) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.34)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const seen = new Set();
      for (const [x, y] of cuts) {
        if (x < 0 || x > w) continue;
        const k = x + '|' + y;
        if (seen.has(k)) continue;
        seen.add(k);
        ctx.moveTo(x + 0.5, y);
        ctx.lineTo(x + 0.5, y + bandH);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.textAlign = 'left';
  }

  function drawSeq() {
    const canvas = paneCanvas('.track[data-track="seq"]');
    const w = canvas.parentElement.clientWidth;
    const bpPerPx = (S.view.end - S.view.start) / w;
    const cellW = 1 / bpPerPx;
    const drawLetter = cellW >= 8;
    // 一个氨基酸占 3 个碱基格，格宽 ≥3 px 才排得下字母
    const transOn = transOnFor('seq') && cellW >= 3;
    const { ctx, h } = fitCanvas(canvas, (bpPerPx <= 0.5 ? 62 : 34) + (transOn ? AA_H : 0));
    if (!S.asm.hasSeq) {
      ctx.fillStyle = C.muted;
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(T('该版本未内置序列文件（可从 UCSC 下载 2bit 后放入 data/genomes）'), 12, h / 2);
      $('#seqHint').textContent = T('未内置');
      return;
    }
    if (bpPerPx > 1.2) {
      ctx.fillStyle = C.muted;
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(T('继续放大以显示碱基序列'), 12, h / 2);
      $('#seqHint').textContent = `${bpPerPx.toFixed(0)} bp/px`;
      return;
    }
    $('#seqHint').textContent = `${bpPerPx < 0.1 ? bpPerPx.toFixed(3) : bpPerPx.toFixed(2)} bp/px`;
    const seq = S.data.seq;
    if (!seq) {
      ctx.fillStyle = C.muted;
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(T('读取序列…'), 12, h / 2);
      return;
    }
    const seqStart = S.data.seqStart ?? S.data.range.start;
    const top = 8;
    const barH = 10;
    const rulerY = top + barH + 12 + (transOn ? AA_H : 0);
    const PAD = 4;   // P1-5：左右各留 4 px 安全边，首尾碱基不被画布边缘切一半
    const flip = !!S.seqFlip;   // Flip strand：逐位取互补（同 IGV），坐标不动

    for (let i = 0; i < seq.length; i++) {
      const bp = seqStart + i;
      const x = px(bp);
      if (x + cellW < PAD) continue;
      if (x > w - PAD) break;
      const base = flip ? complementBase(seq[i]) : seq[i];
      const color = BASE_COLORS[base] || C.muted;
      if (drawLetter) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.13;
        ctx.fillRect(x, top, cellW - 0.6, barH);
        ctx.globalAlpha = 1;
        ctx.font = `600 ${Math.min(13, cellW - 2)}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(base, x + cellW / 2, top + barH / 2 + 0.5);
        ctx.textAlign = 'left';
        // position ruler below
        if (bp % 10 === 0) {
          ctx.fillStyle = C.muted;
          ctx.font = '10.5px ui-monospace, Menlo, Consolas, monospace';
          ctx.fillText(String(bp + 1), x + 1, rulerY);
        }
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = base === 'N' ? 0.35 : 0.75;
        ctx.fillRect(x, top, Math.max(1, cellW + 0.4), barH);
        ctx.globalAlpha = 1;
      }
    }
    if (transOn) {
      // 翻译行紧贴在碱基下方；-1 让上边缘压住碱基色条下沿，不留缝
      // flip 时按互补链翻译（负链基因点 ⇄ 后氨基酸随之改变）
      drawAminoAcids(ctx, seq, seqStart, w, cellW, top + barH - 1, flip, S.trans.table);
    }
    if (drawLetter) {
      // amino-acid style ticks every 3 bases are skipped for clarity
      ctx.fillStyle = C.muted;
      ctx.font = '10.5px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(flip ? T('5′←3′ (−) 链') : T('5′→3′ (+) 链'), 4, h - 6);
    }
  }

  /* ---------------------------------------------------------------- overview */
  const OV = { rowH: 14, top: 8, left: 58 };

  function overviewChroms() {
    return primaryChroms().map((c) => [c, S.asm.chroms[c]]);
  }

  function overviewHeight() {
    // P0-1：默认折叠成单行条带（26 px），只显示当前染色体 + 视野框；
    // 点开 ovToggle 才展开回 25 行全览（展开态仅在会话内有效，不落盘）。
    return S.overviewExpanded ? OV.top + overviewChroms().length * OV.rowH + 8 : 26;
  }

  function drawOverview() {
    // 分屏后每屏一条（各自的高亮染色体 + 各自的视野框），不再是一条共用的
    const canvas = paneCanvas('.track[data-track="overview"]');
    const chroms = overviewChroms();
    const { ctx, w } = fitCanvas(canvas, overviewHeight());
    ctx.textBaseline = 'middle';

    // ---- 折叠态：单行当前染色体条带 + 红色视野框 + 右侧上下文文字 ----
    if (!S.overviewExpanded) {
      const chrom = S.view.chrom, len = S.asm.chroms[chrom] || 1;
      const y = 13;
      ctx.font = '10.5px ui-monospace, Menlo, Consolas, monospace';
      const aMb = (S.view.start / 1e6).toFixed(2);
      const bMb = (S.view.end / 1e6).toFixed(2);
      const totMb = (len / 1e6).toFixed(1);
      const txt = T(`${aMb}–${bMb} Mb · 共 ${totMb} Mb`);
      const tw = ctx.measureText(txt).width;
      const bw = Math.max(14, w - OV.left - tw - 20);
      // 条带
      ctx.fillStyle = C.accent;
      roundRect(ctx, OV.left, y - 3.5, bw, 7, 3.5); ctx.fill();
      // 视野框（红色实心竖条）
      const x1 = OV.left + (S.view.start / len) * bw;
      const x2 = OV.left + (S.view.end / len) * bw;
      ctx.fillStyle = C.viewLine;
      ctx.fillRect(x1, y - 4.5, Math.max(1.5, x2 - x1), 9);
      // 左：当前染色体名
      ctx.fillStyle = C.accent;
      ctx.fillText(chrom, 4, y);
      // 右：上下文文字（右对齐）
      ctx.fillStyle = C.muted;
      ctx.fillText(txt, w - tw - 8, y);
      return;
    }

    // ---- 展开态：25 行全览（原逻辑） ----
    const maxLen = Math.max(...chroms.map((c) => c[1]));
    const avail = Math.max(60, w - OV.left - 14);
    ctx.font = '9.5px ui-monospace, Menlo, Consolas, monospace';

    chroms.forEach(([chrom, len], i) => {
      const y = OV.top + i * OV.rowH + OV.rowH / 2;
      const bw = Math.max(14, (len / maxLen) * avail);
      const active = chrom === S.view.chrom;
      ctx.fillStyle = active ? C.accent : C.grid;
      roundRect(ctx, OV.left, y - 3.5, bw, 7, 3.5);
      ctx.fill();
      ctx.fillStyle = active ? C.accent : C.muted;
      ctx.fillText(chrom, 4, y);
      if (active) {
        const x1 = OV.left + (S.view.start / len) * bw;
        const x2 = OV.left + (S.view.end / len) * bw;
        // 视野指示只留一根红色实心竖条，不再套外框（外框在窄视野时会变成一个黑方块）
        ctx.fillStyle = C.viewLine;
        ctx.fillRect(x1, y - 4.5, Math.max(1.5, x2 - x1), 9);
      }
    });
  }

  // 同步总览的「展开 / 收起」按钮与副标题（render 末尾调用）
  function syncOverviewCtl() {
    const btn = $('#ovToggle');
    if (btn) {
      btn.setAttribute('aria-pressed', S.overviewExpanded ? 'true' : 'false');
      btn.textContent = S.overviewExpanded ? '▴' : '▾';
    }
    const sub = $('#ovSub');
    if (sub) sub.textContent = S.overviewExpanded ? overviewChroms().length + T(' 条染色体') : T('点击展开全部');
  }

  function overviewHit(y) {
    const chroms = overviewChroms();
    const i = Math.floor((y - OV.top) / OV.rowH);
    if (i < 0 || i >= chroms.length) return null;
    return chroms[i][0];
  }

  /* ------------------------------------------------------ 全基因组视野（IGV） */
  /* 一条染色体一格，宽度按长度比例分配；格子里画细胞遗传带（复用 S.bands）。
     点格子 = 看整条染色体；这是染色体下拉里「全部染色体」的落点。 */
  const GV = { pad: 12, gap: 4, bandH: 34, nameH: 16 };

  function genomeSlots() {
    const chroms = primaryChroms()
      .map((c) => ({ name: c, len: S.asm.chroms[c] || 0 }))
      .filter((c) => c.len > 0);
    const total = chroms.reduce((s, c) => s + c.len, 0) || 1;
    return { chroms, total };
  }

  function genomeLayout(w) {
    const { chroms, total } = genomeSlots();
    const avail = Math.max(60, w - GV.pad * 2 - GV.gap * Math.max(0, chroms.length - 1));
    let x = GV.pad;
    const slots = [];
    for (const c of chroms) {
      const sw = Math.max(5, (c.len / total) * avail);
      slots.push({ name: c.name, len: c.len, x, w: sw });
      x += sw + GV.gap;
    }
    return { slots, total };
  }

  function drawGenomeView() {
    const canvas = paneCanvas('.track[data-track="genome"]');
    if (!canvas || !S.asm) return;
    const view = $('#view');
    // 画布高度取可视区一半（有上下限），内容垂直居中：
    // 只有一条带子时既不显得像没画完，也不会留下一大片空白
    const vh = view ? view.clientHeight : 420;
    // 下面还要放 SEG 全基因组热图时，染色体带子只占一条，别把屏幕吃光
    const hasHeat = S.bw.list.some((t) => t.heatmap && bwActive(t));
    const H = hasHeat ? 132 : Math.max(200, Math.min(420, Math.round(vh * 0.5)));
    const { ctx, w } = fitCanvas(canvas, H);
    const { slots, total } = genomeLayout(w);
    S._gvSlots = slots;
    const blockH = GV.bandH + GV.nameH + 6;
    const y0 = Math.max(10, Math.round((H - blockH) / 2));
    const y = y0;
    const yb = y + GV.bandH;
    const outline = S.theme === 'dark' ? '#808080' : '#000000';
    const dpr = S.dpr || 1;
    const ln = 1 / dpr;
    const snap = (v) => Math.round(v * dpr) / dpr;

    // 顶部的总览说明
    ctx.textBaseline = 'middle';
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = C.muted;
    const head = T(`${S.asm.id} · ${(total / 1e9).toFixed(2)} Gb · ${slots.length} 条染色体 · 点染色体看整条`);
    ctx.fillText(head, GV.pad, y - 16);

    for (const s of slots) {
      const bands = (S.bands || {})[s.name] || [];
      const x0 = snap(s.x);
      const bw = Math.max(ln, snap(s.x + s.w) - x0);
      const sx = (bp) => x0 + (bp / s.len) * bw;
      if (!bands.length) {
        ctx.fillStyle = C.grid;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(x0, y, bw, GV.bandH);
        ctx.globalAlpha = 1;
      } else {
        for (const [bs, be, bname, stain] of bands) {
          const a = snap(sx(bs));
          const b = snap(sx(be));
          const wband = Math.max(ln, b - a);
          if (stain === 'acen') {
            const pArm = String(bname || '').startsWith('p');
            const cy = (y + yb) / 2;
            ctx.beginPath();
            if (pArm) { ctx.moveTo(a, yb); ctx.lineTo(a, y); ctx.lineTo(b, cy); }
            else { ctx.moveTo(b, yb); ctx.lineTo(b, y); ctx.lineTo(a, cy); }
            ctx.closePath();
            ctx.fillStyle = '#b20000';
            ctx.fill();
            continue;
          }
          const m = /^gpos(\d+)$/.exec(stain || '');
          const shade = m ? Math.round(255 - (Number(m[1]) / 100) * 255) : null;
          ctx.fillStyle = shade === null ? '#ffffff' : `rgb(${shade},${shade},${shade})`;
          ctx.fillRect(a, y, wband, GV.bandH);
          // 带子窄到 1 px 以下时不要描边：几十条黑边叠起来会把整条染色体糊成黑块
          if (wband >= 2) {
            ctx.strokeStyle = outline;
            ctx.lineWidth = ln;
            ctx.strokeRect(a + ln / 2, y + ln / 2, Math.max(ln, wband - ln), GV.bandH - ln);
          }
        }
      }
      ctx.lineWidth = 1;
      // 染色体名（窄格子里放不下就不画，悬停有提示）
      ctx.font = '10.5px ui-monospace, Menlo, Consolas, monospace';
      const label = s.name.replace(/^chr/, '');
      const tw = ctx.measureText(label).width;
      if (tw + 4 <= s.w) {
        ctx.fillStyle = C.text;
        ctx.fillText(label, x0 + (s.w - tw) / 2, yb + 10);
      }
    }
    // 底部提示
    ctx.font = '10.5px system-ui, sans-serif';
    ctx.fillStyle = C.dim;
    ctx.fillText(T('点击任意染色体进入该条染色体的完整视野'), GV.pad, yb + GV.nameH + 14);
  }

  function genomeHit(x) {
    const slots = S._gvSlots || [];
    for (const s of slots) if (x >= s.x - GV.gap / 2 && x <= s.x + s.w + GV.gap / 2) return s;
    return null;
  }

  /* ------------------------------------------------------ find motif（IGV） */
  /* 对齐 IGV 的 Tools → Find Motif：
       · 输入按行拆，每行一套 pattern，各生成「正链 / 负链」两条轨道；
       · 每行先按 IUPAC 简并碱基校验（表同 IGV iupac_regex_table.txt），
         不通过再按「只含 ACGTN 字母的正则」校验；
       · 轨道按当前视野向后端要命中，视野 > 1 Mb 时整条轨道隐藏
         （IGV MotifTrack.setVisibilityWindow(1e6)）。 */
  const MOTIF_VIS = 1_000_000;
  const MOTIF_H = 34;
  const MOTIF_IUPAC = {
    G: 'G', A: 'A', T: 'T', C: 'C',
    R: '[RGA]', Y: '[YTC]', M: '[MAC]', K: '[KGT]', S: '[SGC]', W: '[WAT]',
    H: '[HACT]', B: '[BGTC]', V: '[VGCA]', D: '[DGAT]', N: '.',
  };

  // 返回 {mode, rx} 或 null（不合法）
  function motifMode(pattern) {
    const up = String(pattern || '').trim().toUpperCase();
    if (!up) return null;
    if ([...up].every((c) => MOTIF_IUPAC[c])) {
      return { mode: 'iupac', rx: [...up].map((c) => MOTIF_IUPAC[c]).join('') };
    }
    try { new RegExp(up); } catch { return null; }
    if (![...up].every((c) => !/[A-Z]/.test(c) || 'ACGTN'.includes(c))) return null;
    return { mode: 'regex', rx: up };
  }

  function motifKey(t, v) { return `${t.pattern}\u0000${v.chrom}:${v.start}-${v.end}`; }

  function pruneMotifCache() {
    const keys = Object.keys(S.motif.cache);
    if (keys.length <= 48) return;
    for (const k of keys.slice(0, keys.length - 48)) delete S.motif.cache[k];
  }

  // 取当前视野的命中；没有缓存就发请求并返回 null（下一帧再画）
  function motifData(t) {
    const v = S.view;
    const key = motifKey(t, v);
    const rec = S.motif.cache[key];
    if (rec) return rec;
    if (S.motif.inflight[key]) return null;
    S.motif.inflight[key] = 1;
    const qs = new URLSearchParams({ db: S.asm.id, chrom: v.chrom, s: v.start, e: v.end, pattern: t.pattern });
    fetch(`api/motif?${qs}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return j;
      })
      .then((j) => {
        S.motif.cache[key] = { hits: j.hits || [], truncated: !!j.truncated,
                               mode: j.mode, reason: j.reason || null };
      })
      .catch((e) => { S.motif.cache[key] = { hits: [], error: String((e && e.message) || e) }; })
      .finally(() => { delete S.motif.inflight[key]; pruneMotifCache(); scheduleRender(); });
    return null;
  }

  function motifCount(t, rec) {
    let n = 0;
    for (const h of rec.hits) if (h.strand === t.strand) n++;
    return n;
  }

  function drawMotifs() {
    if (!S.motif.list.length) return;
    const v = S.view;
    const span = v.end - v.start;
    const mid = Math.round(MOTIF_H / 2) + 0.5;
    const hint = (ctx, txt) => {
      ctx.save();
      ctx.fillStyle = C.muted;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, 10, MOTIF_H / 2);
      ctx.restore();
    };
    for (const t of S.motif.list) {
      const canvas = paneCanvas(`.track[data-motif="${t.id}"]`);
      if (!canvas) continue;
      const { ctx, w } = fitCanvas(canvas, MOTIF_H);
      // 基线：没有位点时也不至于是一条空白行
      ctx.save();
      ctx.strokeStyle = C.borderSoft;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
      ctx.restore();
      if (!v.chrom) continue;
      if (span > MOTIF_VIS) { hint(ctx, T('视野超过 1 Mb，motif 轨道已隐藏（放大后自动出现）')); continue; }
      const rec = motifData(t);
      if (!rec) { hint(ctx, T('查找中…')); continue; }
      if (rec.error) { hint(ctx, rec.error); continue; }
      if (rec.reason) { hint(ctx, T(rec.reason)); continue; }
      const bp = span / w;
      let n = 0;
      ctx.save();
      ctx.fillStyle = t.strand === '+' ? C.motifPos : C.motifNeg;
      for (const h of rec.hits) {
        if (h.strand !== t.strand) continue;
        const x1 = (h.s - v.start) / bp;
        const x2 = (h.e - v.start) / bp;
        if (x2 < -2 || x1 > w + 2) continue;
        ctx.fillRect(x1, MOTIF_H / 2 - 5.5, Math.max(1.5, x2 - x1), 11);
        n++;
      }
      ctx.restore();
      if (!n) hint(ctx, T('该视野内没有位点'));
    }
  }

  function refreshMotifLabels() {
    if (!S.motif.list.length) return;
    const v = S.view;
    const wide = v.end - v.start > MOTIF_VIS;
    for (const t of S.motif.list) {
      const row = document.querySelector(`#view .track[data-motif="${t.id}"]`);
      if (!row) continue;
      const sub = row.querySelector('.track-label .sub');
      if (!sub) continue;
      if (wide) { sub.textContent = T('视野过大，已隐藏'); continue; }
      const rec = S.motif.cache[motifKey(t, v)];
      if (!rec) { sub.textContent = T('查找中…'); continue; }
      if (rec.error) { sub.textContent = T('出错'); continue; }
      if (rec.reason) { sub.textContent = T('无序列'); continue; }
      const n = motifCount(t, rec);
      sub.textContent = (rec.truncated ? '≥ ' : '') + n + T(' 个位点');
    }
  }

  function ensureMotifTrackEls() {
    const view = $('#view');
    if (!view) return;
    for (const old of $$('#view .track[data-motif]')) old.remove();
    if (S.motif.list.length) {
      const anchor = view.querySelector('.track[data-track="overview"]') || $('#empty');
      for (const t of S.motif.list) {
        const el = document.createElement('div');
        el.className = 'track';
        el.dataset.motif = t.id;
        el.dataset.tkey = 'motif:' + t.id;
        el.innerHTML = '<div class="track-label"><span class="nm"></span><div class="sub"></div>'
          + T('<button class="mx" title="移除这条 motif 轨道">×</button></div>')
          + '<div class="track-body" data-split><canvas></canvas></div>';
        const nm = el.querySelector('.nm');
        nm.textContent = t.name;
        nm.title = `${t.name}  ·  ${t.pattern}`;
        el.querySelector('.mx').onclick = (ev) => {
          ev.stopPropagation();
          removeMotifTrack(t.id);
        };
        view.insertBefore(el, anchor);
      }
      applyTrackOrder();
    }
    syncPanes();
    refreshMotifLabels();
  }

  function removeMotifTrack(id) {
    const i = S.motif.list.findIndex((t) => t.id === id);
    if (i < 0) return;
    S.motif.list.splice(i, 1);
    ensureMotifTrackEls();
    scheduleRender();
  }

  function addMotifTrack(pattern, strand, name) {
    S.motif.list.push({
      id: 'm' + (++S.motif.seq),
      pattern,
      strand,
      name: (name || motifAutoName(pattern)),
    });
  }

  function motifAutoName(pattern) {
    const p = String(pattern || '').trim();
    return (p || 'motif').slice(0, 100);
  }

  /* ---- 对话框 ---- */
  function setMotifErr(msg) {
    const box = $('#motifErr');
    if (!box) return;
    box.textContent = msg || '';
    box.hidden = !msg;
  }

  function motifLines(raw) {
    return String(raw || '').split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
  }

  // 轨道名默认跟着第一行 pattern 走（同 IGV）；多行时自动命名、两个输入框置灰
  function syncMotifNames(force) {
    const pat = $('#motifPattern');
    const pos = $('#motifPos');
    const neg = $('#motifNeg');
    if (!pat || !pos || !neg) return;
    const lines = motifLines(pat.value);
    if (lines.length > 1) {
      pos.value = T('自动命名');
      neg.value = T('自动命名');
      pos.disabled = true;
      neg.disabled = true;
      return;
    }
    pos.disabled = false;
    neg.disabled = false;
    if (force || !S.motif.nameTouched) {
      const nm = motifAutoName(lines[0] || '');
      pos.value = nm === 'motif' ? '' : nm;
      neg.value = pos.value ? nm + ' Negative' : '';
    }
  }

  function openMotifDialog() {
    const dlg = $('#motifDlg');
    if (!dlg) return;
    closeTrackPop();   // P1-4：浮层互斥，打开对话框前先关掉轨道设置弹窗
    const pat = $('#motifPattern');
    if (pat && !pat.value) pat.value = S.motif.lastPattern || '';
    S.motif.nameTouched = false;
    setMotifErr('');
    syncMotifNames(true);
    dlg.hidden = false;
    if (pat) { pat.focus(); pat.select(); }
  }

  function closeMotifDialog() {
    const dlg = $('#motifDlg');
    if (dlg) dlg.hidden = true;
  }

  function submitMotif() {
    const raw = ($('#motifPattern') || {}).value || '';
    const lines = motifLines(raw);
    if (!lines.length) { setMotifErr(T('请填写要查找的序列或正则')); return; }
    for (const line of lines) {
      if (!motifMode(line)) {
        setMotifErr(T(`「${line}」不是合法的查找模式：\n`)
          + T('· IUPAC 简并碱基写法不能含特殊字符（例如 AARNNR）\n')
          + T('· 正则写法除特殊字符外只能是 ACGTN（例如 TATAAA(A){3,}）'));
        return;
      }
    }
    const multi = lines.length > 1;
    let posName = (($('#motifPos') || {}).value || '').trim();
    let negName = (($('#motifNeg') || {}).value || '').trim();
    if (!multi) {
      if (!posName) posName = motifAutoName(lines[0]);
      if (!negName) negName = posName + ' Negative';
      if (posName.toLowerCase() === negName.toLowerCase()) {
        setMotifErr(T('正链和负链的轨道名不能相同'));
        return;
      }
    }
    for (const line of lines) {
      const pn = multi ? motifAutoName(line) : posName;
      const nn = multi ? pn + ' Negative' : negName;
      addMotifTrack(line, '+', pn);
      addMotifTrack(line, '-', nn);
    }
    S.motif.lastPattern = raw;
    closeMotifDialog();
    ensureMotifTrackEls();
    scheduleRender();
  }


  /* ------------------------------------------------------- track settings */
  const PREFS_KEY = 'orbit.prefs.v1';
  // 分屏布局只保留「本次会话」：刷新（F5）还在，重新打开程序就回到单屏。
  // 放 sessionStorage 而不是 localStorage —— 后者会让每次启动都恢复上次的分屏，
  // 用户会觉得「怎么默认打开就是分屏」。
  const SPLIT_KEY = 'orbit.split.v1';

  // 每次启动都当「第一次打开软件」：把上次留下的偏好整份丢掉。
  // 包括轨道顺序、标签列宽度、展开的转录本、隐藏的轨道、配色/分组/基因配色、
  // 以及上次的分屏布局。想改回「记住上次」把它设成 false 即可。
  const FRESH_EACH_LAUNCH = true;
  // 上面这一整份重置里，只有一项要跨启动保留：导入轨道的显示/隐藏。
  // 否则用户导入的 SEG 热图、bigWig 下次打开全是关的，看起来像「导入没成功」。
  const KEEP_ACROSS_LAUNCH = ['bwOnSaved'];
  let keptPrefs = null;   // resetStoredPrefs 里抢出来的、要延续到下次启动的几项

  function resetStoredPrefs() {
    if (!FRESH_EACH_LAUNCH) return;
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const p = JSON.parse(raw) || {};
        keptPrefs = {};
        for (const k of KEEP_ACROSS_LAUNCH) if (p[k] !== undefined) keptPrefs[k] = p[k];
      }
      localStorage.removeItem(PREFS_KEY);
      localStorage.removeItem('orbit.expLabels');
      // 改名前的旧键（igvlocal.*）顺手清掉，免得老机器上留一堆死数据
      for (const k of ['igvlocal.prefs.v1', 'igvlocal.expLabels']) localStorage.removeItem(k);
    } catch { /* private mode */ }
    try {
      sessionStorage.removeItem(SPLIT_KEY);
      sessionStorage.removeItem('igvlocal.split.v1');
    } catch { /* ignore */ }
    S.expLabels = true;   // 模块顶层已经读过一次，这里要同步回默认
  }

  const BW_PALETTE = ['#4a6fa5', '#a8624f', '#4f8a6b', '#7a6a9c', '#b08b3e', '#4f8a99',
    '#8a5a72', '#5f6b7a', '#2f3a48', '#9aa5b1'];

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      const p = raw ? JSON.parse(raw) : null;
      if (p) {
        if (p.bwCfg && typeof p.bwCfg === 'object') S.bw.cfg = p.bwCfg;
        if (Array.isArray(p.bwGroups)) S.bw.groups = p.bwGroups;
        if (p.tint && typeof p.tint === 'object') Object.assign(S.tint, p.tint);
        if (p.loadedTint && typeof p.loadedTint === 'object') S.loaded.tint = p.loadedTint;
        if (Array.isArray(p.expanded)) S.expanded = new Set(p.expanded);
        if (Array.isArray(p.loadedExpanded)) S.loaded.expanded = new Set(p.loadedExpanded);
        if (Array.isArray(p.loadedFlip)) S.loaded.flip = new Set(p.loadedFlip);
        if (Array.isArray(p.bwHidden)) S.bw.hidden = new Set(p.bwHidden);
        if (p.bwOnSaved && typeof p.bwOnSaved === 'object') S.bw.onSaved = p.bwOnSaved;
        if (Number.isFinite(p.labelW)) S.labelW = p.labelW;
        if (Array.isArray(p.trackOrder)) S.trackOrder = p.trackOrder.filter((k) => typeof k === 'string');
        if (typeof p.seqFlip === 'boolean') S.seqFlip = p.seqFlip;
        if (p.trans && typeof p.trans === 'object') {
          S.trans.on = !!p.trans.on;
          if (Number.isFinite(p.trans.table)) S.trans.table = p.trans.table;
          if (Array.isArray(p.trans.loaded)) S.trans.loaded = new Set(p.trans.loaded.filter((x) => typeof x === 'string'));
          if (p.trans.loadedTable && typeof p.trans.loadedTable === 'object') {
            for (const [k, v] of Object.entries(p.trans.loadedTable)) {
              if (Number.isFinite(v)) S.trans.loadedTable[k] = v;
            }
          }
        }
        // 旧版本把 split 写进 localStorage，现在不再读取（见 SPLIT_KEY 的注释）
      }
    } catch { /* corrupt prefs: start clean */ }
    try {
      const rawSplit = sessionStorage.getItem(SPLIT_KEY);
      if (rawSplit) {
        const sp = JSON.parse(rawSplit);
        if (sp && typeof sp === 'object') S._splitPref = sp;
      }
    } catch { /* ignore */ }
    // FRESH_EACH_LAUNCH 清掉的那份偏好里，只有导入轨道的显示状态继续沿用
    if (keptPrefs && keptPrefs.bwOnSaved && typeof keptPrefs.bwOnSaved === 'object') {
      S.bw.onSaved = keptPrefs.bwOnSaved;
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        bwCfg: S.bw.cfg, bwGroups: S.bw.groups, tint: S.tint,
        loadedTint: S.loaded.tint,
        expanded: [...S.expanded],
        loadedExpanded: [...S.loaded.expanded],
        loadedFlip: [...S.loaded.flip],
        bwHidden: [...S.bw.hidden],
        bwOnSaved: S.bw.onSaved,
        labelW: S.labelW,
        trackOrder: S.trackOrder,
        seqFlip: !!S.seqFlip,
        trans: {
          on: !!S.trans.on, table: S.trans.table,
          loaded: [...S.trans.loaded], loadedTable: { ...S.trans.loadedTable },
        },
      }));
    } catch { /* private mode / quota */ }
    try {
      // 分屏布局只写 sessionStorage：同一次会话刷新能恢复，重新启动则是单屏
      sessionStorage.setItem(SPLIT_KEY, JSON.stringify(
        { count: S.panels.length, loci: S.panels.map((p) => ({ ...p.view })) }));
    } catch { /* private mode / quota */ }
  }

  function bwCfg(tid) {
    const c = S.bw.cfg[tid] || {};
    const defMax = c.max;
    return {
      color: c.color || S.bw.colors[tid] || BW_PALETTE[0],
      mode: c.mode === 'fixed' ? 'fixed' : 'auto',
      min: Number.isFinite(c.min) ? c.min : 0,
      max: Number.isFinite(defMax) && defMax > (Number.isFinite(c.min) ? c.min : 0)
        ? defMax : 10,
      group: c.group || '',
      log: !!c.log,
      // 比对视图专用：按正负链给 read 上色（IGV 的 Color by → strand）
      strandColor: !!c.strandColor,
      junctionVisible: c.junctionVisible !== false,
      alignDisplay: ['collapsed', 'expanded', 'squished', 'full'].includes(c.alignDisplay) ? c.alignDisplay : 'squished',
      experimentType: ['auto', 'other', 'rna', 'third_gen'].includes(c.experimentType) ? c.experimentType : 'auto',
      visibilityWindowKb: Number.isFinite(c.visibilityWindowKb) && c.visibilityWindowKb > 0
        ? c.visibilityWindowKb : null,
      // 拷贝数热图：增益色 / 缺失色 / 振幅（0 = 自动）
      heatHigh: c.heatHigh || '',
      heatLow: c.heatLow || '',
      heatMax: Number.isFinite(c.heatMax) ? c.heatMax : 0,
      // 中性色（值为 0 的格子）：空 = 自动（面板色掺 7% 前景色）
      heatMid: c.heatMid || '',
      // 拷贝数热图布局：row = 样本为行（默认）；col = 样本为列（转置，常规 CNV 矩阵）；
      // none = 紧凑，不画样本名（悬停看）
      segLayout: c.segLayout === 'col' ? 'col' : (c.segLayout === 'none' ? 'none' : 'row'),
      segNameW: Number.isFinite(c.segNameW) ? c.segNameW : 0,   // 0 = 按最长样本名自动
      // 是否显示左侧样本名列（默认显示）；关掉后热图多出一列的宽度
      segNames: c.segNames !== false,
      // 是否在热图下方显示 CNV Summary 汇总行（默认显示）
      segSummary: c.segSummary !== false,
      // 不想看的样本（按 d.rows 下标）：空数组 = 全部显示，这是默认
      segHide: Array.isArray(c.segHide) ? c.segHide.filter((n) => Number.isInteger(n) && n >= 0) : [],
    };
  }

  // 勾选后的可见样本下标；样本顺序跟 d.rows 一致（后端按 t.samples 顺序出行）
  function segVisible(cfg, n) {
    const off = new Set(cfg.segHide || []);
    const idx = [];
    for (let i = 0; i < n; i++) if (!off.has(i)) idx.push(i);
    return idx;
  }

  function setBwCfg(tid, patch) {
    S.bw.cfg[tid] = Object.assign(bwCfg(tid), patch);
    savePrefs();
    renderBwList();
    scheduleRender();
  }

  /* 基因配色：RefSeq 用全局 tint；导入的 GTF 优先用自己的 tint[tid]，未设置的项
     回落到全局 tint，再回落到主题默认值 —— 这样默认两者一致，单独改一条轨道也不会
     影响另一条。 */
  function geneTint(trackId) {
    const own = (trackId && S.loaded.tint[trackId]) || {};
    const pick = (key, dflt) => own[key] || S.tint[key] || dflt;
    return {
      plus: pick('genesPlus', C.plus),
      minus: pick('genesMinus', C.minus),
      cds: pick('cds', C.cds || C.text),
      utr: pick('utr', C.utr || C.muted),
    };
  }

  function strandColor(pal, strand) {
    return strand === '-' ? pal.minus : pal.plus;
  }

  function groupById(id) {
    return id ? (S.bw.groups.find((g) => g.id === id) || null) : null;
  }

  function groupTag(id) {
    const g = groupById(id);
    if (!g) return '';
    return g.name.replace(/^分组\s*/, 'G');
  }

  function createGroup() {
    const n = S.bw.groups.length + 1;
    const g = { id: 'g' + Date.now().toString(36), name: T('分组 ') + n, shared: true };
    S.bw.groups.push(g);
    savePrefs();
    return g;
  }

  // y-axis range of a single track: fixed numbers, or auto from the window peak
  function bwRange(t) {
    const cfg = bwCfg(t.id);
    if (cfg.mode === 'fixed') {
      return { lo: cfg.min, hi: cfg.max > cfg.min ? cfg.max : cfg.min + 1 };
    }
    const d = S.bw.data[t.id];
    if (!d || !d.values) return { lo: 0, hi: 1 };
    // 拷贝数（SEG）：纵轴必须关于 0 对称。否则 +1.2 的增益和 −0.6 的缺失
    // 会画成一样高，一眼看不出方向 —— IGV 的 copy-number 轨也是这样做的。
    // 振幅封顶 5（log2 5 ≈ 32 拷贝）：SEG 里 −29.9 这种值只出现在「只有两三个
    // 探针」的区间，是纯合缺失的假信号；不封顶的话它一个人就能把整条轨道压成一条线。
    if (d.diverging || t.diverging) {
      const amp = Math.min(Math.max(d.peak || 0, Math.abs(d.trough || 0)), 5);
      // 刻度用更细的档位：niceMax 只有 1/2/5 三档，2.87 会被抬到 5，
      // 柱子只剩一半高，看着像没数据。拷贝数常用档位是 0.5 / 1 / 1.5 / 2 / 3 …
      const LADDER = [0.2, 0.4, 0.6, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5];
      let m = 1;
      if (amp > 0) {
        const want = amp * 1.08;
        m = LADDER.find((s) => want <= s) || 5;
      }
      return { lo: -m, hi: m };
    }
    const peak = d.peak || 0;
    // peak 为 0（窗口里全是 0）时不能拿 1e-9 当底：niceMax 会算出 2e-9，
    // 刻度就变成 0 – 2.0e-9 这种没法读的东西。回落成 0–1 更符合直觉。
    return { lo: 0, hi: peak > 0 ? niceMax(peak * 1.15) : 1 };
  }

  // when several tracks share a group, they all use the union of their ranges
  function bwGroupRange(cfg) {
    const g = groupById(cfg.group);
    if (!g || !g.shared) return null;
    const members = S.bw.list.filter((x) => bwCfg(x.id).group === g.id && bwActive(x));
    if (members.length < 2) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const m of members) {
      const r = bwRange(m);
      lo = Math.min(lo, r.lo);
      hi = Math.max(hi, r.hi);
    }
    return Number.isFinite(lo) && Number.isFinite(hi) ? { lo, hi } : null;
  }

  /* ---- settings popover ---- */
  let popTarget = null;

  function closeTrackPop() {
    const pop = $('#tpop');
    if (pop) pop.hidden = true;
    popTarget = null;
  }

  function openTrackPop(anchor, kind, id, detail = null) {
    popTarget = { kind, id, detail };
    const pop = $('#tpop');
    renderPop();
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = r.right + 10;
    if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - 10);
    let top = r.top - 2;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    bindTrackPopDrag(pop);
  }

  // 弹窗内容变高以后（例如展开「全部内含子」）要重新贴回窗口内，
  // 否则底部连同「重置 / 完成」一起被切在窗口外。
  function clampTrackPop() {
    const pop = $('#tpop');
    if (!pop || pop.hidden) return;
    const r = pop.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, Math.max(8, window.innerWidth - r.width - 8)));
    const top = Math.max(8, Math.min(r.top, Math.max(8, window.innerHeight - r.height - 8)));
    if (left !== r.left) pop.style.left = left + 'px';
    if (top !== r.top) pop.style.top = top + 'px';
  }

  function bindTrackPopDrag(pop) {
    if (pop._dragBound) return;
    pop._dragBound = true;
    let drag = null;
    pop.addEventListener('pointerdown', (e) => {
      const header = e.target.closest('h5');
      if (e.button !== 0 || !header || !pop.contains(header)) return;
      const r = pop.getBoundingClientRect();
      drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
      pop.setPointerCapture(e.pointerId);
      e.preventDefault(); e.stopPropagation();
    });
    pop.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const r = pop.getBoundingClientRect();
      const left = Math.max(8, Math.min(Math.max(8, window.innerWidth - r.width - 8), e.clientX - drag.dx));
      const top = Math.max(8, Math.min(Math.max(8, window.innerHeight - 32), e.clientY - drag.dy));
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
      e.preventDefault();
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      drag = null;
      if (pop.hasPointerCapture(e.pointerId)) pop.releasePointerCapture(e.pointerId);
    };
    pop.addEventListener('pointerup', end);
    pop.addEventListener('pointercancel', end);
    pop.addEventListener('lostpointercapture', () => { drag = null; });
  }

  function colorRow(current, onPick) {
    const wrap = document.createElement('div');
    wrap.className = 'chips';
    const markSel = (el) => {
      for (const c of wrap.querySelectorAll('.chip')) c.classList.toggle('sel', c === el);
    };
    for (const c of BW_PALETTE) {
      const b = document.createElement('button');
      b.className = 'chip' + (c.toLowerCase() === current.toLowerCase() ? ' sel' : '');
      b.style.background = c;
      b.dataset.c = c.toLowerCase();
      b.title = c;
      b.onclick = () => { markSel(b); onPick(c); };
      wrap.appendChild(b);
    }
    // native picker = 任意颜色
    const custom = document.createElement('label');
    custom.className = 'chip-custom';
    custom.title = T('自定义任意颜色');
    const native = document.createElement('input');
    native.type = 'color';
    native.value = current;
    native.oninput = (e) => { markSel(null); onPick(e.target.value); };
    const txt = document.createElement('span');
    txt.textContent = T('自定义');
    custom.append(native, txt);
    wrap.appendChild(custom);
    return wrap;
  }

  function renderPop() {
    const pop = $('#tpop');
    if (!popTarget) { pop.hidden = true; return; }
    pop.innerHTML = '';
    if (popTarget.kind === 'align') return renderPopAlign(pop, popTarget.id);
    if (popTarget.kind === 'junc') return renderPopJunc(pop, popTarget.id);
    if (popTarget.kind === 'bw') return renderPopBw(pop, popTarget.id);
    if (popTarget.kind === 'genes') return renderPopGenes(pop);
    if (popTarget.kind === 'lgenes') return renderPopGenes(pop, popTarget.id);
    return renderPopGC(pop);
  }

  function popHead(pop, title) {
    const h = document.createElement('h5');
    h.textContent = title;
    pop.appendChild(h);
  }

  function popFoot(pop, onReset) {
    const foot = document.createElement('div');
    foot.className = 'foot';
    const reset = document.createElement('button');
    reset.className = 'btn';
    reset.textContent = T('重置');
    reset.onclick = onReset;
    const done = document.createElement('button');
    done.className = 'btn pri';
    done.textContent = T('完成');
    done.onclick = closeTrackPop;
    foot.append(reset, done);
    pop.appendChild(foot);
  }

  function popSep(pop) {
    const d = document.createElement('div');
    d.className = 'sep';
    pop.appendChild(d);
  }

  function popRow(pop, labelText) {
    const row = document.createElement('div');
    row.className = 'row';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = labelText;
    row.appendChild(lbl);
    pop.appendChild(row);
    return row;
  }

  // 多样本 SEG 的热图设置：增益 / 缺失两套颜色 + 振幅
  function renderPopSegHeat(pop, tid, cfg, track) {
    popHead(pop, T(`拷贝数热图 · ${tid}`));

    // 布局：样本为行（默认）/ 样本为列（转置）/ 紧凑（不画名字）
    const layRow = popRow(pop, T('布局'));
    const mkLay = (text, val, title) => {
      const b = document.createElement('button');
      b.className = 'btn' + (cfg.segLayout === val ? ' pri' : '');
      b.textContent = T(text);
      b.title = T(title);
      b.onclick = () => { setBwCfg(tid, { segLayout: val }); renderPop(); };
      return b;
    };
    layRow.append(
      mkLay('样本为行', 'row', '一行一个样本，样本名在左侧（默认）'),
      mkLay('样本为列', 'col', '一列一个样本（常规 CNV 矩阵的摆法），样本名在顶部'),
      mkLay('紧凑', 'none', '不画样本名，轨道更矮；点轨道看详情'),
    );

    popSep(pop);
    // 样本名列：和侧栏那个「Aa」按钮是同一项设置
    const nmRow = popRow(pop, T('样本名列'));
    const nmChk = document.createElement('input');
    nmChk.type = 'checkbox';
    nmChk.checked = cfg.segNames !== false;
    nmChk.onchange = () => { setBwCfg(tid, { segNames: nmChk.checked }); };
    const nmTxt = document.createElement('span');
    nmTxt.style.cssText = 'font-size:11.5px;color:var(--text-dim)';
    nmTxt.textContent = T('在热图左侧单独占一列');
    nmRow.append(nmChk, nmTxt);

    const smRow = popRow(pop, T('CNV Summary 行'));
    const smChk = document.createElement('input');
    smChk.type = 'checkbox';
    smChk.checked = cfg.segSummary !== false;
    smChk.onchange = () => { setBwCfg(tid, { segSummary: smChk.checked }); };
    const smTxt = document.createElement('span');
    smTxt.style.cssText = 'font-size:11.5px;color:var(--text-dim)';
    smTxt.textContent = T('热图下方汇总所有选中样本');
    smRow.append(smChk, smTxt);

    // 显示哪些样本：默认全选。取消勾选的样本既不画行也不画列，
    // 轨道高度（样本为行/紧凑）和振幅定标都只按勾上的样本算。
    popSep(pop);
    const dNow = S.bw.data[tid];
    const allNames = (dNow && dNow.samples) || track.sampleNames || [];
    const nAll = Math.max(track.samples || 0, allNames.length, 0);
    let off = new Set(cfg.segHide || []);
    const head = document.createElement('div');
    head.className = 'smp-head';
    const hl = document.createElement('span');
    hl.className = 'lbl';
    hl.textContent = T('显示样本');
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    const syncCnt = () => { cnt.textContent = `${nAll - off.size}/${nAll}`; };
    syncCnt();
    const mkAct = (text, fn) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = T(text);
      b.onclick = fn;
      return b;
    };
    head.append(hl, cnt, mkAct('全选', () => { setBwCfg(tid, { segHide: [] }); renderPop(); }),
      mkAct('全不选', () => {
        const all = [];
        for (let i = 0; i < nAll; i++) all.push(i);
        setBwCfg(tid, { segHide: all });
        renderPop();   // 批量改要重建浮层，否则勾选框还停在旧状态
      }));
    pop.appendChild(head);

    const list = document.createElement('div');
    list.className = 'smp-list';
    for (let i = 0; i < nAll; i++) {
      const nm = String(allNames[i] || `#${i + 1}`);
      const lab = document.createElement('label');
      lab.className = 'smp' + (off.has(i) ? ' off' : '');
      lab.title = nm;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !off.has(i);
      cb.onchange = () => {
        const next = new Set(off);
        if (cb.checked) next.delete(i); else next.add(i);
        off = next;
        lab.classList.toggle('off', !cb.checked);
        syncCnt();
        setBwCfg(tid, { segHide: [...next].sort((a, b) => a - b) });
      };
      const sp = document.createElement('span');
      sp.textContent = nm;
      lab.append(cb, sp);
      list.appendChild(lab);
    }
    pop.appendChild(list);
    if (!nAll) { head.hidden = true; list.hidden = true; }

    popSep(pop);
    const gRow = popRow(pop, T('增益颜色'));
    gRow.appendChild(colorRow(cfg.heatHigh || C.cnvGain, (c) => setBwCfg(tid, { heatHigh: c })));
    const lRow = popRow(pop, T('缺失颜色'));
    lRow.appendChild(colorRow(cfg.heatLow || C.cnvLoss, (c) => setBwCfg(tid, { heatLow: c })));
    // 中性色：值为 0（log2 ratio ≈ 0）时用的颜色
    const mRow = popRow(pop, T('零值颜色'));
    mRow.appendChild(colorRow(cfg.heatMid || rgbHex(segMidRGB()), (c) => setBwCfg(tid, { heatMid: c })));
    popSep(pop);
    const aRow = popRow(pop, T('振幅 ±'));
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = 'any';
    inp.min = '0';
    inp.value = cfg.heatMax > 0 ? cfg.heatMax : '';
    inp.placeholder = T('自动');
    inp.onchange = () => {
      const v = parseFloat(inp.value);
      setBwCfg(tid, { heatMax: Number.isFinite(v) && v > 0 ? v : 0 });
    };
    aRow.appendChild(inp);
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = T('振幅留空时按整个文件的 |log2 比值| 97 分位自动定标，缩放时颜色不变。');
    pop.appendChild(hint);

    // 删除该轨道：SEG 走的是热图这一套浮层，以前漏了这个按钮，
    // 结果齿轮 / 右键里只有「重置 / 完成」，导入的 SEG 看起来删不掉。
    popSep(pop);
    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger';
    delBtn.textContent = T('删除该轨道');
    delBtn.style.width = '100%';
    delBtn.onclick = () => { bwDelete([tid]); };
    pop.appendChild(delBtn);

    popFoot(pop, () => {
      setBwCfg(tid, { heatHigh: '', heatLow: '', heatMid: '', heatMax: 0, segLayout: 'row', segNameW: 0, segHide: [] });
      renderPop();
    });
  }

  function renderPopJunc(pop, tid) {
    popHead(pop, 'Junctions');
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = T('仅隐藏当前子轨道，不删除 BAM 文件。');
    pop.appendChild(hint);
    const row = document.createElement('label');
    row.className = 'row tight';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = bwCfg(tid).junctionVisible;
    cb.onchange = () => { setBwCfg(tid, { junctionVisible: cb.checked }); ensureBwTrackEls(); clearJunctionTrack(tid); };
    const text = document.createElement('span'); text.textContent = T('显示 Junctions');
    row.append(cb, text); pop.appendChild(row);
    const remove = document.createElement('button');
    remove.className = 'btn'; remove.textContent = T('移除当前轨道');
    remove.onclick = () => { setBwCfg(tid, { junctionVisible: false }); clearJunctionTrack(tid); ensureBwTrackEls(); closeTrackPop(); };
    pop.appendChild(remove);
  }

  function renderPopAlign(pop, tid) {
    popHead(pop, 'Alignments');
    const cfg = bwCfg(tid);
    const remove = document.createElement('button');
    remove.className = 'btn'; remove.textContent = T('移除当前轨道');
    remove.onclick = () => { S.bw.on[tid + ALIGN_SUF] = false; ensureBwTrackEls(); renderBwList(); closeTrackPop(); scheduleRender(); };
    remove.title = T('仅隐藏当前子轨道，不删除 BAM 文件。');
    pop.appendChild(remove);
    for (const [value, title] of [['collapsed', 'Collapsed'], ['expanded', 'Expanded'], ['squished', 'Squished'], ['full', 'Full']]) {
      const row = document.createElement('label');
      row.className = 'row tight';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'align-display-' + tid;
      radio.checked = cfg.alignDisplay === value;
      radio.onchange = () => {
        setBwCfg(tid, { alignDisplay: value });
        for (const P of S.panels) {
          const d = P.alignData[tid];
          if (d) { delete d.readLayout; delete d.alignScroll; }
        }
        closeTrackPop();
      };
      const text = document.createElement('span');
      text.textContent = title;
      row.append(radio, text);
      pop.appendChild(row);
    }
  }

  function renderPopBw(pop, tid) {
    const cfg = bwCfg(tid);
    const d = S.bw.data[tid];
    const trk = S.bw.list.find((t) => t.id === tid) || {};
    if (trk.heatmap) return renderPopSegHeat(pop, tid, cfg, trk);
    popHead(pop, T(`信号轨道 · ${tid}`));

    // colour
    const cRow = popRow(pop, T('颜色'));
    cRow.appendChild(colorRow(cfg.color, (c) => setBwCfg(tid, { color: c })));

    popSep(pop);

    // range mode
    const modeRow = popRow(pop, T('数据范围'));
    const mkRadio = (val, text) => {
      const l = document.createElement('label');
      l.className = 'rad';
      const i = document.createElement('input');
      i.type = 'radio';
      i.name = 'rmode-' + tid;
      i.checked = cfg.mode === val;
      i.onchange = () => {
        const next = { mode: val };
        if (val === 'fixed' && cfg.mode === 'auto') {
          const auto = bwRange({ id: tid });
          next.min = Math.round(auto.lo * 1000) / 1000;
          next.max = Math.round(auto.hi * 1000) / 1000;
        }
        setBwCfg(tid, next);
        renderPop();
      };
      l.append(i, document.createTextNode(' ' + text));
      return l;
    };
    modeRow.append(mkRadio('auto', T('自动')), mkRadio('fixed', T('固定')));

    const numRow = popRow(pop, T('最小 / 最大'));
    const mkNum = (val, key) => {
      const i = document.createElement('input');
      i.type = 'number';
      i.step = 'any';
      i.value = val;
      i.disabled = cfg.mode !== 'fixed';
      i.onchange = () => {
        const v = parseFloat(i.value);
        if (Number.isFinite(v)) setBwCfg(tid, { [key]: v });
      };
      return i;
    };
    numRow.append(mkNum(cfg.min, 'min'), mkNum(cfg.max, 'max'));

    const hint = document.createElement('div');
    hint.className = 'hint';
    if (cfg.log) {
      hint.textContent = T('对数刻度（log10）：纵轴从窗口内最小正值起算，适合跨数量级的信号。');
    } else if (cfg.mode === 'fixed') {
      hint.textContent = T('固定后纵轴不再随窗口变化；最小值可设负数（如 log2 比值）。');
    } else if (d && d.values) {
      hint.textContent = T(`当前窗口峰值 ${formatVal(d.peak || 0)}，纵轴自动取整。`);
    } else {
      hint.textContent = T('纵轴按当前窗口峰值自动缩放。');
    }
    pop.appendChild(hint);

    const logRow = document.createElement('label');
    logRow.className = 'row tight';
    const logCb = document.createElement('input');
    logCb.type = 'checkbox';
    logCb.checked = cfg.log;
    logCb.onchange = () => {
      setBwCfg(tid, { log: logCb.checked });
      renderPop();
    };
    const logTxt = document.createElement('span');
    logTxt.className = 'lbl';
    logTxt.style.flex = 'none';
    logTxt.textContent = T('对数刻度（log10）');
    logRow.append(logCb, logTxt);
    pop.appendChild(logRow);

    // BAM 才有比对视图，按链着色只对它有意义（IGV 的 Color by → strand）
    const bt = S.bw.list.find((x) => x.id === tid);
    if (isBam(bt)) {
      popSep(pop);
      const experimentRow = popRow(pop, T('实验类型'));
      const experiment = document.createElement('select');
      for (const [value, label] of [['auto', '自动识别'], ['other', '普通'], ['rna', 'RNA'], ['third_gen', '第三代测序']]) {
        const option = document.createElement('option');
        option.value = value; option.textContent = T(label); experiment.appendChild(option);
      }
      experiment.value = cfg.experimentType;
      experiment.onchange = () => {
        setBwCfg(tid, { experimentType: experiment.value });
        resetAlignmentWindow(tid);
        renderPop();
      };
      experimentRow.appendChild(experiment);
      const windowRow = popRow(pop, T('最大窗口（kb）'));
      const windowInput = document.createElement('input');
      windowInput.type = 'number'; windowInput.min = '0'; windowInput.step = 'any';
      windowInput.placeholder = T('默认');
      windowInput.value = cfg.visibilityWindowKb ?? '';
      windowInput.onchange = () => {
        const value = Number(windowInput.value);
        if (windowInput.value.trim() && (!Number.isFinite(value) || value <= 0)) {
          windowInput.value = cfg.visibilityWindowKb ?? '';
          return;
        }
        setBwCfg(tid, { visibilityWindowKb: windowInput.value.trim() ? value : null });
        resetAlignmentWindow(tid);
        renderPop();
      };
      windowRow.appendChild(windowInput);
      const windowHint = document.createElement('div');
      windowHint.className = 'hint';
      windowHint.textContent = T(`当前生效 ${alignmentVisibility(bt) / 1000} kb；覆盖度、比对和剪接共用。留空按实验类型：普通 30、RNA 300、第三代 1000 kb；自动识别未知时按普通。`);
      pop.appendChild(windowHint);
      const sRow = document.createElement('label');
      sRow.className = 'row tight';
      const sCb = document.createElement('input');
      sCb.type = 'checkbox';
      sCb.checked = cfg.strandColor;
      sCb.onchange = () => {
        setBwCfg(tid, { strandColor: sCb.checked });
        scheduleRender();
      };
      const sTxt = document.createElement('span');
      sTxt.className = 'lbl';
      sTxt.style.flex = 'none';
      sTxt.textContent = T('比对视图按链着色');
      sRow.append(sCb, sTxt);
      pop.appendChild(sRow);
    }

    popSep(pop);

    // group
    const gRow = popRow(pop, T('轨道分组'));
    const sel = document.createElement('select');
    const optNone = document.createElement('option');
    optNone.value = '';
    optNone.textContent = T('（不分组）');
    sel.appendChild(optNone);
    for (const g of S.bw.groups) {
      const o = document.createElement('option');
      o.value = g.id;
      o.textContent = g.name;
      sel.appendChild(o);
    }
    const optNew = document.createElement('option');
    optNew.value = '__new';
    optNew.textContent = T('+ 新建分组…');
    sel.appendChild(optNew);
    sel.value = cfg.group;
    sel.onchange = () => {
      if (sel.value === '__new') {
        const g = createGroup();
        setBwCfg(tid, { group: g.id });
        renderPop();
        return;
      }
      setBwCfg(tid, { group: sel.value });
      renderPop();
    };
    gRow.appendChild(sel);

    const g = groupById(cfg.group);
    if (g) {
      const shareRow = document.createElement('label');
      shareRow.className = 'row tight';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!g.shared;
      cb.onchange = () => {
        g.shared = cb.checked;
        savePrefs();
        renderBwList();
        scheduleRender();
      };
      const t = document.createElement('span');
      t.className = 'lbl';
      t.style.flex = 'none';
      t.textContent = T('组内共享纵轴（group autoscale）');
      shareRow.append(cb, t);
      pop.appendChild(shareRow);

      const cnt = S.bw.list.filter((x) => bwCfg(x.id).group === g.id).length;
      const gh = document.createElement('div');
      gh.className = 'hint';
      gh.textContent = T(`本组 ${cnt} 条轨道；开启后取组内最大范围统一缩放。`);
      pop.appendChild(gh);
    }

    // 删除该轨道（内置轨道隐藏、已导入轨道删副本），与右键批量删除同一套逻辑
    popSep(pop);
    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger';
    delBtn.textContent = T('删除该轨道');
    delBtn.style.width = '100%';
    delBtn.onclick = () => { bwDelete([tid]); };
    pop.appendChild(delBtn);

    popFoot(pop, () => {
      delete S.bw.cfg[tid];
      savePrefs();
      renderBwList();
      if (isBam(trk)) resetAlignmentWindow(tid);
      scheduleRender();
      renderPop();
    });
  }

  // trackId = null -> 全局（RefSeq）设置；否则写入该导入轨道自己的设置
  function setGeneTint(trackId, key, val, quiet) {
    if (trackId) {
      const own = S.loaded.tint[trackId] || (S.loaded.tint[trackId] = {});
      if (val == null) delete own[key]; else own[key] = val;
      if (!Object.keys(own).length) delete S.loaded.tint[trackId];
    } else {
      S.tint[key] = val;
    }
    if (quiet) return;
    savePrefs();
    scheduleRender();
  }

  // 编号来自当前转录本模型，CDS/UTR 片段由 exon 与 CDS 范围相交得到。
  function geneFeatureDetails(g, tx, bp) {
    if (!tx || bp < tx.start || bp >= tx.end) return null;
    const exons = (tx.exons || []).filter((e) => e[1] > e[0]).slice().sort((a, b) => a[0] - b[0]);
    const introns = [];
    for (let i = 1; i < exons.length; i++) {
      if (exons[i - 1][1] < exons[i][0]) introns.push([exons[i - 1][1], exons[i][0]]);
    }
    const coding = Number.isFinite(tx.cdsStart) && Number.isFinite(tx.cdsEnd) && tx.cdsEnd > tx.cdsStart;
    const cds = [], low = [], high = [];
    if (coding) {
      for (const [s, e] of exons) {
        if (Math.max(s, tx.cdsStart) < Math.min(e, tx.cdsEnd)) cds.push([Math.max(s, tx.cdsStart), Math.min(e, tx.cdsEnd)]);
        if (s < Math.min(e, tx.cdsStart)) low.push([s, Math.min(e, tx.cdsStart)]);
        if (Math.max(s, tx.cdsEnd) < e) high.push([Math.max(s, tx.cdsEnd), e]);
      }
    }
    const reverse = g.strand === '-';
    const features = [];
    const add = (kind, intervals) => {
      intervals.forEach(([start, end], i) => {
        if (bp >= start && bp < end) features.push({ kind, number: reverse ? intervals.length - i : i + 1, total: intervals.length, start, end });
      });
    };
    add('exon', exons);
    add('intron', introns);
    add('CDS', cds);
    add('5UTR', reverse ? high : low);
    add('3UTR', reverse ? low : high);
    const intronList = introns.map(([start, end], i) => ({
      kind: 'intron', number: reverse ? introns.length - i : i + 1,
      total: introns.length, start, end,
    })).sort((a, b) => a.number - b.number);
    return { geneName: g.name || '', geneId: g.id || g.geneId || g.gene_id || '', txId: tx.name || '', strand: g.strand || '.', coding, features, introns: intronList };
  }

  function geneDetailsAt(x, y, track = null, pid = S.act) {
    const bp = Math.floor(bpAt(x));
    const layout = track ? { placed: placedForPane(track, pid) } : geneLayout();
    const rowH = track ? LROW : ROW_H;
    const entries = [];
    for (const p of layout.placed) {
      if (layout.maxRows != null && p.r >= layout.maxRows) continue;
      const row = Math.floor((y - 6) / rowH) - p.r;
      if (row < 0 || row >= p.span || bp < p.g.start || bp >= p.g.end) continue;
      let txs = p.txl || p.g.tx || [];
      if (p.expanded) {
        const tx = track ? loadedTxAt({ _placedByPane: { [pid]: [p] } }, x, y, pid)
          : txs[txs.length === 1 ? 0 : txIndexAt(p.g, y)];
        txs = tx ? [tx] : [];
      }
      const matches = txs.map((tx) => geneFeatureDetails(p.g, tx, bp)).filter(Boolean);
      if (matches.length) entries.push(...matches);
      else if (!p.expanded) entries.push({ geneName: p.g.name || '', geneId: p.g.id || p.g.geneId || p.g.gene_id || '', txId: '', strand: p.g.strand || '.', features: [] });
    }
    return { chrom: S.view.chrom, bp, entries };
  }

  function geneDetailsForEvent(e, track = null) {
    const pane = eventPane(e);
    if (!pane.rect || !pane.el || !pane.el.querySelector('canvas')) return null;
    const x = e.clientX - pane.rect.left;
    const y = e.clientY - pane.rect.top;
    if (x < 0 || x >= pane.rect.width || y < 0 || y >= pane.rect.height) return null;
    return withPanel(pane.idx, () => geneDetailsAt(x, y, track, pane.idx));
  }

  function geneFeatureHoverText(detail) {
    if (!detail || !detail.entries.length) return '';
    return detail.entries.map(entry => {
      const intron = entry.features.find(f => f.kind === 'intron');
      const name = `${entry.geneName} · ${entry.txId}`;
      if (!intron) return name;
      return name + ' · ' + T('内含子') + ' ' + T(`第 ${intron.number} 个 / 共 ${intron.total} 个`) +
        ` · ${detail.chrom}:${fmt(intron.start + 1)}–${fmt(intron.end)} · ${fmt(intron.end - intron.start)} bp`;
    }).join('\n');
  }

  function renderGeneDetails(pop, detail) {
    if (!detail) return;
    popHead(pop, T('基因位置详情'));
    const position = document.createElement('div');
    position.textContent = T('鼠标位置（1 基）') + ': ' + detail.chrom + ':' + fmt(detail.bp + 1);
    pop.appendChild(position);
    const list = document.createElement('div');
    // 内含子清单也在这块滚动区里；260px 只够三四条，展开后基本看不到内容，
    // 所以高度跟着窗口走，展开时再把清单滚进可视范围。
    list.style.cssText = 'max-height:clamp(200px,42vh,560px);overflow:auto;overflow-wrap:anywhere;font-size:11.5px';
    pop.appendChild(list);
    const featureLabels = { exon: '外显子', intron: '内含子', CDS: 'CDS 片段', '5UTR': '5′ UTR 片段', '3UTR': '3′ UTR 片段' };
    for (const entry of detail.entries) {
      const block = document.createElement('div');
      block.style.cssText = 'padding:7px 0;border-bottom:1px solid var(--border-soft)';
      const add = (label, value) => {
        const line = document.createElement('div');
        line.textContent = T(label) + ': ' + value;
        block.appendChild(line);
      };
      add('基因名称', entry.geneName || T('未提供'));
      add('基因 ID', entry.geneId || T('未提供'));
      add('转录本 ID', entry.txId || T('此位置无转录本'));
      add('链方向', entry.strand);
      for (const f of entry.features) {
        add(featureLabels[f.kind], T(`第 ${f.number} 个 / 共 ${f.total} 个`));
        add('位置区间（1 基，含两端）', `${detail.chrom}:${fmt(f.start + 1)}–${fmt(f.end)}`);
        add('长度', `${fmt(f.end - f.start)} bp`);
      }
      if (entry.introns) {
        add('内含子总数', String(entry.introns.length));
        if (entry.introns.length) {
          const intronBox = document.createElement('details');
          intronBox.open = entry.features.some(f => f.kind === 'intron');
          const summary = document.createElement('summary');
          summary.textContent = T('全部内含子：编号、区间与长度');
          intronBox.appendChild(summary);
          // 展开后把清单滚到滚动区可视范围内，否则它可能整段落在折叠区外
          intronBox.addEventListener('toggle', () => {
            if (!intronBox.open) return;
            intronBox.scrollIntoView({ block: 'nearest' });
            // 内容高度要等一次布局才稳定，两层 rAF 后再贴回窗口内
            requestAnimationFrame(() => requestAnimationFrame(clampTrackPop));
            setTimeout(clampTrackPop, 80);
          });
          for (const intron of entry.introns) {
            const line = document.createElement('div');
            line.style.cssText = 'padding:4px 0;overflow-wrap:anywhere';
            const current = intron.start <= detail.bp && detail.bp < intron.end;
            if (current) line.style.fontWeight = '700';
            line.textContent = (current ? T('当前位置') + ' · ' : '') + T('内含子') + ' ' +
              T(`第 ${intron.number} 个 / 共 ${intron.total} 个`) + ' · ' +
              `${detail.chrom}:${fmt(intron.start + 1)}–${fmt(intron.end)} · ${fmt(intron.end - intron.start)} bp`;
            intronBox.appendChild(line);
          }
          block.appendChild(intronBox);
        }
      }
      if (entry.coding === false) add('编码状态', T('非编码转录本'));
      list.appendChild(block);
    }
    if (!detail.entries.length) list.textContent = T('此位置未命中基因结构');
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:var(--text-dim);margin-top:6px';
    note.textContent = T('编号按转录方向；CDS/UTR 为当前模型推导片段，非原始注释 feature 编号。');
    pop.appendChild(note);
    popSep(pop);
  }

  function renderPopGenes(pop, trackId) {
    renderGeneDetails(pop, popTarget && popTarget.detail);
    const isLoaded = !!trackId;
    popHead(pop, isLoaded ? T(`基因轨道 · ${trackId}`) : T('基因轨道 · RefSeq'));
    const pal = geneTint(trackId || null);

    // 显示方式（同 IGV 基因轨道的 Display mode）：折叠为一行 / 分行排布 / 全部展开
    const allOn = expandAllOn(trackId || null);
    const isCollapsed = geneCollapsed(trackId || null) && !allOn;
    const modeRow = popRow(pop, T('显示方式'));
    const mkMode = (text, on, title, act) => {
      const b = document.createElement('button');
      b.className = 'btn' + (on ? ' pri' : '');
      b.textContent = T(text);
      b.title = T(title);
      b.onclick = () => { act(); renderPop(); };
      return b;
    };
    modeRow.append(
      mkMode('折叠一行', isCollapsed,
        '所有基因画在同一行，重叠就重叠（同 IGV 的 collapsed，默认）',
        () => setGeneCollapsed(trackId || null, true)),
      mkMode('分行排布', !isCollapsed && !allOn,
        '重叠的基因逐行往上叠，基因多时行数会变多',
        () => setGeneCollapsed(trackId || null, false)),
      mkMode('全部展开', allOn,
        '每个转录本占一行；平移/缩放后新出现的基因也保持展开',
        () => { setGeneCollapsed(trackId || null, false); setExpandAll(trackId || null, true); }),
    );

    const rows = [
      [T('正链颜色'), 'genesPlus', pal.plus],
      [T('负链颜色'), 'genesMinus', pal.minus],
      [T('CDS 颜色'), 'cds', pal.cds],
      [T('UTR 颜色'), 'utr', pal.utr],
    ];
    for (const [label, key, cur] of rows) {
      const row = popRow(pop, label);
      row.appendChild(colorRow(cur, (c) => setGeneTint(trackId, key, c)));
    }
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = (isLoaded
      ? T('仅作用于这条导入轨道；未设置的颜色沿用 RefSeq 轨道的设置。')
      : T('作用于 RefSeq 轨道；导入的 GTF 轨道默认跟随这里的设置。'))
      + (allOn
        ? T(' 当前：全部展开（单独点某个基因的 − 可以只收起它）。')
        : isCollapsed
          ? T(' 当前：折叠为一行；点基因看右侧详情，或在详情里单独展开某个基因。')
          : T(' 当前：分行排布（点基因右侧的 + 展开单个基因）。'));
    pop.appendChild(hint);
    popFoot(pop, () => {
      for (const [, key] of rows) setGeneTint(trackId, key, null, true);
      setExpandAll(trackId || null, false);
      setGeneCollapsed(trackId || null, true);
      savePrefs();
      scheduleRender();
      renderPop();
    });
  }

  function renderPopGC(pop) {
    popHead(pop, T('GC 轨道'));
    const row = popRow(pop, T('曲线颜色'));
    row.appendChild(colorRow(S.tint.gc || '#7d8b9c', (c) => {
      S.tint.gc = c; savePrefs(); scheduleRender();
    }));
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = T('纵轴固定为 30%–70%，窗口过窄时按每格 ≥20 bp 合并。');
    pop.appendChild(hint);
    popFoot(pop, () => {
      S.tint.gc = null; savePrefs(); scheduleRender(); renderPop();
    });
  }

  /* ---------------------------------------------------------------- bigWig */
  const BW_COLORS = ['#4a6fa5', '#a8624f', '#4f8a6b', '#7a6a9c', '#b08b3e', '#4f8a99'];

  // 记住导入轨道的勾选状态（内置轨道不记，见 S.bw.onSaved 的注释）
  function rememberBwOn(id, val) {
    const t = S.bw.list.find((x) => x.id === id);
    if (!t || !t.loaded) return;
    S.bw.onSaved[id] = !!val;
    savePrefs();
  }

  async function loadBwTracks(opts) {
    const fresh = !!(opts && opts.fresh);
    let tracks = [];
    try {
      const r = await api('bwtracks');
      tracks = r.tracks || [];
    } catch { /* no bigWig support */ }
    // drop bundled tracks the user removed (persisted in prefs, restorable)
    tracks = tracks.filter((t) => t.loaded || !S.bw.hidden.has(t.id));
    // 重新拉列表时要保住用户当前手动开关的状态：以前这里直接重建 S.bw.on，
    // 结果「导入一个新文件」会把之前关掉的轨道全部重新打开（反之也可能被关掉）。
    const prevOn = S.bw.on || {};
    S.bw.list = tracks;
    S.bw.on = {};
    for (const P of S.panels) { P.bwData = {}; P.alignData = {}; }
    tracks.forEach((t, i) => {
      S.bw.colors[t.id] = BW_COLORS[i % BW_COLORS.length];
      // 启动时（fresh）自己导入过的轨道默认也是打开的：用户导入的文件下次打开就该还在，
      // 全关着会让人以为「导入没成功」。（早期版本是默认关，用户反馈过两次）
      const savedOn = t.loaded ? S.bw.onSaved[t.id] : undefined;
      const had = Object.prototype.hasOwnProperty.call(prevOn, t.id);
      S.bw.on[t.id] = !fresh && had ? !!prevOn[t.id]
        : (savedOn !== undefined ? !!savedOn : (t.loaded ? true : i < 6));
      // BAM 的比对视图默认打开（想收起来就取消左侧那一行的勾）
      const aid = alignId(t);
      const hadAlign = Object.prototype.hasOwnProperty.call(prevOn, aid);
      if (hadAlign && !fresh) S.bw.on[aid] = !!prevOn[aid];
      else if (isBam(t) && S.bw.on[aid] === undefined) S.bw.on[aid] = true;
    });
    const sec = $('#bwSec');
    sec.hidden = tracks.length === 0 && S.bw.hidden.size === 0;
    renderBwList();
    ensureBwTrackEls();
    if (S.asm && S.asm.custom) refreshCustomChroms();
    if (tracks.length) ensureAll(true);
  }

  // 侧栏用的短标签（完整文件名只出现在画布左列）
  function bwShortKind(t) {
    if (t.heatmap) {
      const n = t.samples || 0;
      const off = (bwCfg(t.id).segHide || []).length;
      return off ? `热图 · ${Math.max(0, n - off)}/${n} 样本` : `热图 · ${n} 样本`;
    }
    if (isBam(t)) return 'BAM';
    if (t.format === 'seg') return 'SEG';
    if (t.format === 'bigwig') return 'bigWig';
    if (t.format === 'bedgraph') return 'bedGraph';
    if (t.format === 'wig') return 'WIG';
    return t.format || '信号';
  }

  function renderBwList() {
    const box = $('#bwList');
    if (!box) return;
    box.innerHTML = '';    for (const t of S.bw.list) {
      const ok = bwMatchesAsm(t);
      const cfg = bwCfg(t.id);
      const tag = groupTag(cfg.group);
      const el = document.createElement('div');
      el.className = 'trk bw-trk' + (ok ? '' : ' off-asm')
        + (S.bw.sel.has(t.id) ? ' sel' : '');
      el.dataset.bwid = t.id;
      el.title = ok
        ? T(`${t.id}\n点名称选择（Ctrl 多选）；右键可统一纵轴 / 批量删除`)
        : T(`${t.id}\n该轨道不属于当前装配（染色体长度不匹配）`);

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'on';
      cb.checked = !!S.bw.on[t.id];
      cb.disabled = !ok;
      cb.onchange = (e) => {
        S.bw.on[t.id] = e.target.checked;
        rememberBwOn(t.id, e.target.checked);
        ensureBwTrackEls();
        if (e.target.checked) ensureAll(true);
        scheduleRender();
      };

      const sw = document.createElement('span');
      sw.className = 'sw';
      // 拷贝数轨道是红/蓝双色，色块也画成上下两半，免得和实际柱子对不上
      sw.style.background = t.heatmap
        ? `linear-gradient(90deg, ${cfg.heatLow || C.cnvLoss}, ${C.panel}, ${cfg.heatHigh || C.cnvGain})`
        : t.diverging
          ? `linear-gradient(180deg, ${C.cnvGain} 0 50%, ${C.cnvLoss} 50% 100%)`
          : cfg.color;
      sw.onclick = (e) => { toggleBwSelect(t.id, e); };

      const nm = document.createElement('span');
      nm.className = 'nm';
      // 侧栏只留控件：文件名已经画在画布左侧的轨道名列里，这里不再重复长名字，
      // 只标类型（热图 / bigWig / BAM …），悬停看全名、并高亮画布上对应的那一行。
      nm.textContent = isBam(t) ? (t.name || t.id) : T(bwShortKind(t));
      nm.onclick = (e) => { toggleBwSelect(t.id, e); };

      const rm = document.createElement('button');
      rm.className = 'loaded-x';
      rm.textContent = '×';
      rm.title = T('删除该轨道');
      rm.onclick = (e) => { e.stopPropagation(); bwDelete([t.id]); };

      const hiLabel = (on) => {
        const l = document.querySelector(`.track[data-bw="${CSS.escape(t.id)}"] .track-label`);
        if (l) l.classList.toggle('hi', on);
      };
      el.onmouseenter = () => hiLabel(true);
      el.onmouseleave = () => hiLabel(false);

      el.append(cb, sw, nm);
      // 热图轨道多一个「Aa」按钮：一键显示 / 隐藏左侧样本名列（和轨道设置里的开关同一项）
      if (t.heatmap) {
        const nb = document.createElement('button');
        nb.className = 'seg-nm-tg' + (cfg.segNames ? ' on' : '');
        nb.textContent = 'Aa';
        nb.title = T('显示 / 隐藏样本名列');
        nb.onclick = (ev) => {
          ev.stopPropagation();
          setBwCfg(t.id, { segNames: !cfg.segNames });
        };
        el.appendChild(nb);
        const sb = document.createElement('button');
        sb.className = 'seg-nm-tg seg-sum-tg' + (cfg.segSummary ? ' on' : '');
        sb.textContent = 'Σ';
        sb.title = T('显示 / 隐藏 CNV Summary 汇总行');
        sb.onclick = (ev) => {
          ev.stopPropagation();
          setBwCfg(t.id, { segSummary: !cfg.segSummary });
        };
        el.appendChild(sb);
      }
      el.appendChild(rm);
      if (tag) {
        const g = document.createElement('span');
        g.className = 'grp';
        g.textContent = tag;
        el.appendChild(g);
      }
      box.appendChild(el);
      // BAM 的第二行：原始比对视图（虚拟轨道，勾选即显示 reads 堆叠）
      if (isBam(t)) {
        const aid = alignId(t);
        const ar = document.createElement('div');
        ar.className = 'trk bw-trk align-trk' + (ok ? '' : ' off-asm');
        ar.dataset.bwidalign = t.id;
        ar.title = T(`${t.id} 比对视图\n勾选显示 reads 堆叠（灰块）；右键该 BAM 可批量删除`);
        const acb = document.createElement('input');
        acb.type = 'checkbox';
        acb.className = 'on';
        acb.checked = alignOn(t) && !!S.bw.on[t.id];
        acb.disabled = !ok;
        acb.onchange = (e) => {
          S.bw.on[aid] = e.target.checked;
          ensureBwTrackEls();
          if (e.target.checked) ensureAll(true);
          scheduleRender();
        };
        const asw = document.createElement('span');
        asw.className = 'sw';
        asw.style.background = 'var(--read, #c9c9c9)';
        const anm = document.createElement('span');
        anm.className = 'nm';
        anm.textContent = 'Alignments';
        const ab = document.createElement('span');
        ab.className = 'grp';
        ab.textContent = 'BAM';
        ar.append(acb, asw, anm, ab);
        box.appendChild(ar);
        const jr = document.createElement('div');
        jr.className = 'trk bw-trk align-trk';
        const jcb = document.createElement('input');
        jcb.type = 'checkbox'; jcb.className = 'on';
        jcb.checked = cfg.junctionVisible && !!S.bw.on[t.id];
        jcb.disabled = !ok;
        jcb.onchange = () => {
          setBwCfg(t.id, { junctionVisible: jcb.checked });
          if (!jcb.checked) clearJunctionTrack(t.id);
          ensureBwTrackEls(); scheduleRender();
        };
        const jname = document.createElement('span');
        jname.className = 'nm'; jname.textContent = 'Junctions';
        jr.title = t.name || t.id;
        jr.append(jcb, jname); box.appendChild(jr);
      }
    }
    if (S.bw.hidden.size) {
      const r = document.createElement('div');
      r.className = 'bw-restore';
      r.textContent = T(`已隐藏 ${S.bw.hidden.size} 条 · 点此恢复`);
      r.title = T('恢复被隐藏的内置信号轨道');
      r.onclick = () => { S.bw.hidden.clear(); savePrefs(); loadBwTracks(); };
      box.appendChild(r);
    }
  }

  function toggleBwSelect(id, e) {
    e.stopPropagation();
    const sel = S.bw.sel;
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      if (sel.has(id)) sel.delete(id); else sel.add(id);
    } else if (sel.size === 1 && sel.has(id)) {
      sel.clear();
    } else {
      sel.clear(); sel.add(id);
    }
    renderBwList();
  }

  function commonGroup(ids) {
    let g = null;
    for (const id of ids) {
      const grp = groupById(bwCfg(id).group);
      if (!grp || !grp.shared) return null;
      if (!g) g = grp;
      else if (g.id !== grp.id) return null;
    }
    return g;
  }

  function closeBwCtx() {
    const ctx = $('#bwCtx');
    if (ctx) ctx.hidden = true;
  }

  function ctxItem(label, onClick, opt) {
    const b = document.createElement('button');
    b.className = 'ctx-item' + (opt && opt.danger ? ' danger' : '');
    if (opt && opt.key) {
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = opt.key;
      b.appendChild(k);
    }
    b.appendChild(document.createTextNode(label));
    b.onclick = () => onClick();
    return b;
  }

  function openBwCtx(x, y) {
    closeTrackPop();
    const menu = $('#bwCtx');
    menu.innerHTML = '';
    const ids = [...S.bw.sel];
    const head = document.createElement('div');
    head.className = 'ctx-head';
    head.textContent = T(`已选 ${ids.length} 条信号轨道`);
    menu.appendChild(head);
    menu.appendChild(ctxItem(T('Group Autoscale · 统一纵轴'), () => bwGroupAutoscale(ids)));
    if (commonGroup(ids)) {
      menu.appendChild(ctxItem(T('取消分组'), () => bwUngroup(ids)));
    }
    const sep = document.createElement('div');
    sep.className = 'ctx-sep';
    menu.appendChild(sep);
    menu.appendChild(ctxItem(T('清除选择'), () => { S.bw.sel.clear(); renderBwList(); closeBwCtx(); }));

    // 统一颜色：把选中的所有轨道一起改色
    const sep2 = document.createElement('div');
    sep2.className = 'ctx-sep';
    menu.appendChild(sep2);
    const cl = document.createElement('div');
    cl.className = 'ctx-head';
    cl.textContent = T(`统一颜色 · ${ids.length} 条轨道`);
    menu.appendChild(cl);
    const cur = bwCfg(ids[0]).color;
    const row = colorRow(cur, (c) => bwSetColor(ids, c));
    row.classList.add('ctx-colors');
    menu.appendChild(row);

    // 拷贝数热图：增益 / 缺失两套颜色（多选时一起改）
    const hm = ids.filter((i) => (S.bw.list.find((t) => t.id === i) || {}).heatmap);
    if (hm.length) {
      const sep4 = document.createElement('div');
      sep4.className = 'ctx-sep';
      menu.appendChild(sep4);
      const hh = document.createElement('div');
      hh.className = 'ctx-head';
      hh.textContent = T('热图颜色（增益 / 缺失）');
      menu.appendChild(hh);
      const hc = bwCfg(hm[0]);
      const rGain = colorRow(hc.heatHigh || C.cnvGain, (c) => bwSetHeat(hm, 'heatHigh', c));
      rGain.classList.add('ctx-colors');
      menu.appendChild(rGain);
      const rLoss = colorRow(hc.heatLow || C.cnvLoss, (c) => bwSetHeat(hm, 'heatLow', c));
      rLoss.classList.add('ctx-colors');
      menu.appendChild(rLoss);
    }

    // 删除：内置轨道只隐藏（可恢复），已导入轨道连同副本文件一起删除
    const sep3 = document.createElement('div');
    sep3.className = 'ctx-sep';
    menu.appendChild(sep3);
    menu.appendChild(ctxItem(T(`删除选中的 ${ids.length} 条轨道`), () => bwDelete(ids), { danger: true }));

    menu.hidden = false;
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    let left = x + 2;
    if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - 2);
    let top = y;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function bwGroupAutoscale(ids) {
    if (!ids.length) return;
    const g = commonGroup(ids) || createGroup();
    g.shared = true;
    for (const id of ids) {
      S.bw.cfg[id] = Object.assign(bwCfg(id), { group: g.id });
      S.bw.on[id] = true; // 让 group autoscale 效果立即可见
      rememberBwOn(id, true);
    }
    savePrefs();
    renderBwList();
    ensureBwTrackEls();
    ensureAll(true);
    scheduleRender();
    closeBwCtx();
    toast(T(`已为 ${ids.length} 条轨道启用 Group Autoscale（${groupTag(g.id)}）`));
  }

  function bwUngroup(ids) {
    for (const id of ids) {
      const c = bwCfg(id);
      if (c.group) { delete c.group; S.bw.cfg[id] = c; }
    }
    savePrefs();
    renderBwList();
    scheduleRender();
    closeBwCtx();
  }

  // 把选中的所有轨道一起改成同一个颜色
  // 热图配色（heatHigh / heatLow / heatMax）
  function bwSetHeat(ids, key, color) {
    for (const id of ids) S.bw.cfg[id] = Object.assign(bwCfg(id), { [key]: color });
    savePrefs();
    renderBwList();
    scheduleRender();
  }

  function bwSetColor(ids, color) {
    for (const id of ids) {
      S.bw.cfg[id] = Object.assign(bwCfg(id), { color });
    }
    savePrefs();
    renderBwList();
    scheduleRender();
    // 菜单里的色板同步高亮
    const menu = $('#bwCtx');
    if (menu) {
      const want = String(color).toLowerCase();
      for (const chip of menu.querySelectorAll('.chip')) {
        chip.classList.toggle('sel', chip.dataset.c === want);
      }
      const nat = menu.querySelector('.chip-custom input[type="color"]');
      if (nat && /^#[0-9a-f]{6}$/i.test(String(color))) nat.value = color;
    }
  }

  // 批量删除选中的信号轨道。内置(bw-data)轨道只从列表隐藏并写入 prefs，可恢复；
  // 已导入(loaded)轨道走 DELETE /api/loaded，会连同 data/loaded 下的副本文件一起删除。
  async function bwDelete(ids) {
    const items = ids.map((id) => S.bw.list.find((t) => t.id === id)).filter(Boolean);
    if (!items.length) { closeBwCtx(); return; }
    const loaded = items.filter((t) => t.loaded);
    const bundled = items.filter((t) => !t.loaded);
    const lines = [];
    if (bundled.length) lines.push(T(`· ${bundled.length} 条内置轨道：仅从列表隐藏，可随时恢复`));
    if (loaded.length) lines.push(T(`· ${loaded.length} 条已导入轨道：会删除 data/loaded 下的副本文件`));
    if (!confirm(T(`确定删除选中的 ${items.length} 条信号轨道？\n${lines.join('\n')}`))) return;
    closeBwCtx();
    closeTrackPop();
    // 删除时把还在跑的取数请求全部作废：否则大 BAM 的 reads/覆盖度请求
    // 挂在那儿，界面上就一直转「载入中」（用户看到：删了还在加载）
    for (const P of S.panels) {
      if (P._ac) { try { P._ac.abort(); } catch { /* ignore */ } }
    }
    S.pending = 0;
    setLoading(false);
    // 先从界面/状态移除，避免渲染器继续为已删轨道发请求
    for (const t of bundled) S.bw.hidden.add(t.id);
    for (const t of items) {
      S.bw.sel.delete(t.id);
      delete S.bw.on[t.id];
      delete S.bw.on[alignId(t)];      // BAM 的比对视图状态一起清掉
      delete S.bw.onSaved[t.id];
      delete S.bw.colors[t.id];
      delete S.bw.cfg[t.id];
      delete S.bw.data[t.id];
      for (const P of S.panels) {
        if (P.bwData) delete P.bwData[t.id];
        if (P.alignData) delete P.alignData[t.id];
      }
      const el = document.querySelector(`.track[data-bw="${CSS.escape(t.id)}"]`);
      if (el) el.remove();
      const ae = document.querySelector(`.track[data-align="${CSS.escape(t.id)}"]`);
      if (ae) ae.remove();
      for (const je of document.querySelectorAll(`.track[data-junc="${CSS.escape(t.id)}"]`)) je.remove();
      clearJunctionTrack(t.id);
    }
    const gone = new Set(ids);
    S.bw.list = S.bw.list.filter((t) => !gone.has(t.id));
    savePrefs();
    renderBwList();
    ensureBwTrackEls();
    const sec = $('#bwSec');
    if (sec) sec.hidden = S.bw.list.length === 0 && S.bw.hidden.size === 0;
    scheduleRender();
    // 再并发删除服务端副本
    await Promise.all(loaded.map(async (t) => {
      try { await fetch(`api/loaded?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' }); }
      catch (err) { toast(T('删除失败：') + err.message); }
    }));
    toast(T(`已删除 ${items.length} 条信号轨道`));
  }

  function ensureBwTrackEls() {
    const view = $('#view');
    const anchor = $('.track[data-track="gc"]');
    const bamIds = new Set(S.bw.list.filter(isBam).map((t) => t.id));
    const seen = new Set();
    for (const je of view.querySelectorAll('.track[data-junc]')) {
      const id = je.dataset.junc;
      if (!bamIds.has(id) || seen.has(id)) je.remove();
      else seen.add(id);
      if (!bamIds.has(id)) clearJunctionTrack(id);
    }
    for (const t of S.bw.list) {
      let el = view.querySelector(`.track[data-bw="${CSS.escape(t.id)}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'track' + (t.heatmap ? ' seg-track' : '');
        el.dataset.bw = t.id;
        el.innerHTML = T(`<div class="track-label bw-label"><span class="nm" title="${t.id}">${t.id}</span>
          <div class="sub"></div>
          <button class="tgear" data-gear="bw" data-bwid="${t.id}" title="轨道设置">⚙</button></div>
          ${t.heatmap ? '<div class="seg-sample-labels" aria-label="样本名称"></div>' : ''}
          <div class="track-body" data-split><canvas></canvas></div>`);
        view.insertBefore(el, anchor);
      }
      el.hidden = !bwActive(t);
      if (!isBam(t)) continue;
      const sample = t.name || t.id;
      const sampleLabel = S.bw.list.some(other => other !== t && (other.name || other.id) === sample)
        ? `${sample} [${t.id}]` : sample;
      el.dataset.bam = 'true';
      const coverageName = el.querySelector('.nm');
      if (coverageName) { coverageName.textContent = `${sampleLabel} · Coverage`; coverageName.title = sampleLabel; }
      // One BAM owns three adjacent tracks: Coverage / Junctions / Alignments.
      let ae = view.querySelector(`.track[data-align="${CSS.escape(t.id)}"]`);
      if (!ae) {
        ae = document.createElement('div');
        ae.className = 'track';
        ae.dataset.align = t.id;
        ae.innerHTML = T(`<div class="track-label bw-label"><span class="nm">Alignments</span>
          <div class="sub"></div></div>
          <div class="track-body" data-split><canvas></canvas></div>`);
      }
      el.after(ae);
      ae.hidden = !alignActive(t);
      // Sashimi 剪接弧轨道：和 IGV 一样挂在 BAM 下面
      let je = view.querySelector(`.track[data-junc="${CSS.escape(t.id)}"]`);
      if (!je) {
        je = document.createElement('div');
        je.className = 'track';
        je.dataset.junc = t.id;
        je.innerHTML = T(`<div class="track-label bw-label"><span class="nm">Junctions</span>
          <div class="sub"></div></div>
          <div class="track-body" data-split><canvas></canvas></div>`);
      }
      el.after(je);
      je.after(ae);
      for (const [row, title] of [[ae, 'Alignments'], [je, 'Junctions']]) {
        const name = row.querySelector('.nm');
        row.dataset.bam = 'true';
        if (name) { name.textContent = `${sampleLabel} · ${title}`; name.title = sampleLabel; }
      }
      je.hidden = !bwActive(t) || !bwCfg(t.id).junctionVisible || S.bw.juncOn === false || S.genomeView;
    }
    applyTrackOrder();
  }

  // A bigWig file carries its own chromosome dictionary, so a track built on
  // hg38 would silently draw human signal on top of mm39 coordinates. Compare a
  // few chromosome sizes against the current assembly to catch that.
  function bwMatchesAsm(t) {
    if (t && t.loaded) return true;   // user imports may cover only part of the genome
    const probe = t.probe || {};
    const keys = Object.keys(probe);
    if (!keys.length || !S.asm) return true;
    return keys.every((k) => S.asm.chroms[k] === probe[k]);
  }

  function bwActive(t) {
    return S.bw.on[t.id] && bwMatchesAsm(t);
  }

  /* ------------------------------------------- BAM 比对视图（reads 堆叠） */
  // IGV 打开 BAM 会出两条轨道：xxx.bam Coverage（走 /api/bw）和 xxx.bam（原始比对）。
  // 这里用「虚拟轨道」实现第二条：id 加 ::align 后缀，共享同一个后端文件。
  const ALIGN_SUF = '::align';
  const alignId = (t) => t.id + ALIGN_SUF;
  const isBam = (t) => !!t && (t.format === 'bam' || t.format === 'sam');
  const alignOn = (t) => S.bw.on[alignId(t)] !== false;
  const alignActive = (t) => isBam(t) && bwActive(t) && alignOn(t);
  function alignmentVisibility(t) {
    const cfg = bwCfg(t.id);
    if (cfg.visibilityWindowKb > 0) return cfg.visibilityWindowKb * 1000;
    const type = String(cfg.experimentType === 'auto' ? (t.experimentType || 'other') : cfg.experimentType)
      .toLowerCase().replace(/[- ]/g, '_');
    if (type === 'rna' || type === 'rna_seq') return 300000;
    if (type === 'third_gen' || type === 'thirdgen') return 1000000;
    return 30000;
  }

  function resetAlignmentWindow(tid) {
    clearJunctionTrack(tid);
    for (const P of S.panels) {
      delete P.bwData[tid];
      delete P.alignData[tid];
    }
    ensureAll(true);
  }
  const ALIGN_ROW_H = 13;      // 每条 read 一行的高度（CSS 像素）；行多时按比例压缩

  function niceMax(v) {
    if (!v || v <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * pow;
  }

  /* ------------------- 多样本 SEG：拷贝数热图（一行一个样本） ------------------- */
  const SEG_ROW_H = 14;          // 每个样本一行的高度（CSS 像素）

  function hexRGB(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
    if (!m) return [128, 128, 128];
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function mixRGB(a, b, t) {
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},`
      + `${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  }

  // 振幅：轨道设置里的固定值优先；否则用窗口内 |值| 的 99 分位。
  // 用最大值不行 —— 一两个纯合缺失格子（log2 −9）会把整张图冲成一片白。
  function segAmp(cfg, rows, t) {
    let amp = cfg.heatMax;
    if (!(amp > 0)) {
      // 优先用整份文件的 99 分位（后端 meta.scale）：IGV 的 CNV 热图缩放时颜色不跳，
      // 而按窗口分位数定标会在放大后把整张图涂成深红深蓝，和 IGV 差得很远。
      const fs2 = t && Number(t.scale);
      if (fs2 > 0) {
        amp = Math.min(Math.max(fs2, 0.1), 4);
        return amp;
      }
      const mags = [];
      for (const r of rows) {
        for (const v of r) if (v != null) mags.push(Math.abs(v));
      }
      if (mags.length) {
        mags.sort((a, b) => a - b);
        // 99 分位（以前用 95）：SEG 的 log2 比值集中在 ±0.3，按 95 分位定标几乎每格都顶到
        // 满色，和 IGV 那种大片浅粉/浅蓝对不上。99 分位把绝大多数格子留在淡色区。
        amp = mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.99))];
      }
      amp = Math.min(Math.max(amp || 0.5, 0.1), 3);
    }
    return amp;
  }

  // 颜色查找表：背景色 →（缺失色 / 增益色）。每帧只算 2×(N+1) 次插值，
  // 逐格再插值的话 10 样本 × 1000 bin 就是一万次字符串拼接
  const SEG_LUT_N = 48;

  // 自动的中性色：面板色掺 7% 前景色（纯面板色会让 log2 全 0 的样本整行消失）
  function segMidRGB() {
    const panel = hexRGB(C.panel || '#ffffff');
    const ink = hexRGB(C.text || '#222222');
    return [0, 1, 2].map((k) => Math.round(panel[k] + (ink[k] - panel[k]) * 0.07));
  }

  function rgbHex(a) {
    return '#' + a.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  }

  function segLuts(cfg) {
    // 中性格（|值|≈0）不能直接用面板底色：log2 ratio 全为 0 的样本会整行/整列消失，
    // 看起来像渲染空洞。掺 7% 前景色做成极浅灰，平坦样本仍能看出「有这条样本」。
    const mid = cfg && cfg.heatMid ? hexRGB(cfg.heatMid) : segMidRGB();
    const gain = hexRGB(cfg.heatHigh || C.cnvGain || '#c0392b');
    const loss = hexRGB(cfg.heatLow || C.cnvLoss || '#2a6fb0');
    const N = SEG_LUT_N;
    const lutG = new Array(N + 1);
    const lutL = new Array(N + 1);
    for (let i = 0; i <= N; i++) {
      lutG[i] = mixRGB(mid, gain, i / N);
      lutL[i] = mixRGB(mid, loss, i / N);
    }
    return { lutG, lutL, N, mid };
  }

  // IGV 风格的多样本 CNV 汇总：每个 bin 对可见样本取均值，正值红、负值蓝。
  function drawSegSummary(ctx, w, y, h, d, rows, amp, lutG, lutL, N) {
    const bins = d.bins || (rows[0] || []).length;
    if (!bins || !rows.length) return;
    const dpr = S.dpr || 1;
    const sn = (v) => Math.round(v * dpr) / dpr;
    const midY = y + Math.round(h * 0.5);
    ctx.save();
    ctx.fillStyle = C.panel;
    ctx.fillRect(0, y, w, h);
    ctx.strokeStyle = C.border;
    ctx.beginPath(); ctx.moveTo(0, sn(midY) + 0.5); ctx.lineTo(w, sn(midY) + 0.5); ctx.stroke();
    const bw = w / bins;
    // 汇总值比单样本小得多（多样本平均互相抵消），单独定标才不会画成一条平线
    const vals = [];
    for (let i = 0; i < bins; i++) {
      let s2 = 0; let cn = 0;
      for (const row of rows) { const v = row && row[i]; if (v != null) { s2 += v; cn++; } }
      vals.push(cn ? Math.abs(s2 / cn) : 0);
    }
    const srt = vals.slice().sort((a, b) => a - b);
    const sumAmp = Math.max(0.05, srt.length ? srt[Math.min(srt.length - 1, Math.floor(srt.length * 0.98))] : 1);
    for (let i = 0; i < bins; i++) {
      let sum = 0; let n = 0;
      for (const row of rows) { const v = row && row[i]; if (v != null) { sum += v; n++; } }
      if (!n) continue;
      const v = sum / n;
      const k = Math.round(segK(v, sumAmp, N));
      ctx.fillStyle = v >= 0 ? lutG[k] : lutL[k];
      const x0 = sn(i * bw); const x1 = sn((i + 1) * bw);
      const bar = Math.max(1 / dpr, Math.abs(v) / sumAmp * (h * 0.42));
      ctx.fillRect(x0, v >= 0 ? sn(midY - bar) : sn(midY), Math.max(1 / dpr, x1 - x0), Math.max(1 / dpr, bar));
    }
    ctx.fillStyle = C.muted;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    // 名称由左侧独立的 .seg-sample-labels 列显示，这里只画汇总曲线
    ctx.restore();
  }

  /* 全基因组视野（选「全部染色体」）的 SEG：像 IGV 那样把每条染色体按长度排成一排，
     样本 × 染色体铺成整块图，下面再跟一条全基因组 CNV Summary。 */
  function drawSegGenome(ctx, w, h, t, d, cfg) {
    const order = (d && d.order) || [];
    if (!order.length) {
      ctx.fillStyle = C.muted;
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(d && d.tooWide ? T('放大查看比对（Zoom in to see alignments）')
        : (d && d.reason ? T(d.reason) : T('读取中…')), 12, h / 2);
      return { amp: 1, n: 0 };
    }
    const allRows = d.rows || [];
    const allNames = d.samples || t.sampleNames || [];
    const idx = segVisible(cfg, allRows.length);
    if (!idx.length) {
      ctx.fillStyle = C.muted;
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(T('未选择样本 · 在轨道设置里勾选'), 12, h / 2);
      return { amp: 1, n: 0 };
    }
    const rows = idx.map((i) => allRows[i]);
    const amp = segAmp(cfg, rows, t);
    const { lutG, lutL, N } = segLuts(cfg);
    const { slots } = genomeLayout(w);
    const byName = {};
    for (const s of slots) byName[s.name] = s;
    const dpr = S.dpr || 1;
    const sn = (v) => Math.round(v * dpr) / dpr;
    const minPx = 1 / dpr;
    const top = 3;
    const summaryH = cfg.segSummary === false ? 0 : 44;
    const n = rows.length;
    const rowH = Math.max(6, Math.floor((Math.max(40, h - summaryH) - top * 2) / Math.max(1, n)));
    // 每条染色体在拼接行里的 bin 偏移
    const offs = [];
    let off = 0;
    for (const o of order) { offs.push(off); off += o.bins || 0; }

    for (let r = 0; r < n; r++) {
      const y = sn(top + r * rowH);
      const rh = Math.max(minPx, sn(rowH - 1));
      const row = rows[r] || [];
      for (let c = 0; c < order.length; c++) {
        const o = order[c];
        const slot = byName[o.name];
        if (!slot || !o.bins) continue;
        const bw = slot.w / o.bins;
        for (let i = 0; i < o.bins; i++) {
          const v = row[offs[c] + i];
          if (v == null) continue;
          const x0 = sn(slot.x + i * bw);
          const x1 = sn(slot.x + (i + 1) * bw);
          const k = Math.round(segK(v, amp, N));
          ctx.fillStyle = v >= 0 ? lutG[k] : lutL[k];
          ctx.fillRect(x0, y, Math.max(minPx, x1 - x0), rh);
        }
      }
    }

    // 染色体之间的细竖线：和上方染色体条对齐，一眼能看出哪块是哪条染色体
    ctx.fillStyle = C.borderSoft;
    for (const s of slots) {
      ctx.fillRect(sn(s.x + s.w), 0, minPx, Math.max(40, h - summaryH));
    }

    // 全基因组 CNV Summary：逐 bin 对可见样本取均值，正值向上红、负值向下蓝
    if (summaryH) {
    const sy = Math.max(40, h - summaryH);
    const midY = sy + Math.round(summaryH * 0.5);
    // 汇总值比单样本小得多（多样本平均会互相抵消），单独定标才不会画成一条平线
    const sums = [];
    for (let c = 0; c < order.length; c++) {
      const o = order[c];
      if (!o.bins) continue;
      for (let i = 0; i < o.bins; i++) {
        let s2 = 0;
        let cn = 0;
        for (const row of rows) {
          const v = row && row[offs[c] + i];
          if (v != null) { s2 += v; cn++; }
        }
        sums.push(cn ? Math.abs(s2 / cn) : 0);
      }
    }
    sums.sort((a, b) => a - b);
    const sumAmp = Math.max(0.05, sums.length ? sums[Math.min(sums.length - 1, Math.floor(sums.length * 0.98))] : 1);
    ctx.fillStyle = C.panel;
    ctx.fillRect(0, sy, w, summaryH);
    ctx.strokeStyle = C.border;
    ctx.beginPath(); ctx.moveTo(0, sn(midY) + 0.5); ctx.lineTo(w, sn(midY) + 0.5); ctx.stroke();
    const half = summaryH * 0.42;
    for (let c = 0; c < order.length; c++) {
      const o = order[c];
      const slot = byName[o.name];
      if (!slot || !o.bins) continue;
      const bw = slot.w / o.bins;
      for (let i = 0; i < o.bins; i++) {
        let sum = 0;
        let cnt = 0;
        for (const row of rows) {
          const v = row && row[offs[c] + i];
          if (v != null) { sum += v; cnt++; }
        }
        if (!cnt) continue;
        const v = sum / cnt;
        const k = Math.round(segK(v, sumAmp, N));
        ctx.fillStyle = v >= 0 ? lutG[k] : lutL[k];
        const x0 = sn(slot.x + i * bw);
        const x1 = sn(slot.x + (i + 1) * bw);
        const bar = Math.max(minPx, Math.abs(v) / sumAmp * half);
        ctx.fillRect(x0, v >= 0 ? sn(midY - bar) : sn(midY), Math.max(minPx, x1 - x0), bar);
      }
    }
    }
    return { amp, n };
  }

  // 值 → 色阶下标。用 gamma 0.6 而不是线性：按 99 分位定标后（和 IGV 观感一致），
  // 线性映射会让 |v| 只有零点几的格子几乎和中性色一样，整块区域看起来「没数据」。
  // 开方级别的压缩把小幅变化抬起来，同时高值仍然会饱和。
  function segK(v, amp, N) {
    const t = Math.min(1, Math.abs(v) / (amp || 1));
    return Math.pow(t, 0.6) * N;
  }

  // 返回 { amp, n } 供调用方写副标题
  function drawSegHeatmap(ctx, w, h, t, d, cfg) {
    if (!d || !d.rows || !d.rows.length) {
      ctx.fillStyle = C.muted;
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(d && d.reason ? T(d.reason) : T('读取中…'), 12, h / 2);
      return { amp: 1, n: 0 };
    }
    // 只画勾选上的样本：d.rows 与 d.samples 同序，按下标筛
    const allRows = d.rows;
    const allNames = d.samples || t.sampleNames || [];
    const idx = segVisible(cfg, allRows.length);
    if (!idx.length) {
      ctx.fillStyle = C.muted;
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(T('未选择样本 · 在轨道设置里勾选'), 12, h / 2);
      return { amp: 1, n: 0 };
    }
    const rows = idx.map((i) => allRows[i]);
    const names = idx.map((i) => allNames[i]);
    const amp = segAmp(cfg, rows, t);
    const { lutG, lutL, N, mid } = segLuts(cfg);
    if (cfg.segLayout === 'col') {
      const res = drawSegHeatCols(ctx, w, h, d, rows, names, amp, lutG, lutL, N);
      ctx.restore();
      return res;
    }
    const n = rows.length;
    const summaryH = cfg.segSummary === false ? 0 : 44;
    const heatH = Math.max(40, h - summaryH);
    const top = 3;
    const rowH = Math.max(6, Math.floor((heatH - top * 2) / Math.max(1, n)));
    const bins = d.bins || (rows[0] || []).length;
    const bp = (d.end - d.start) / Math.max(1, bins);
    const dpr = S.dpr || 1;
    const sn = (v) => Math.round(v * dpr) / dpr;
    const minPx = 1 / dpr;

    // 样本名称由 .seg-sample-labels 独立 DOM 列承担；Canvas 从第一个 bin 开始完整画数据。
    const gutter = 0;
    // px() 是按整幅画布宽度算的，这里把结果压进数据区 [gutter, w]
    const kx = Math.max(1, w - gutter) / Math.max(1, w);
    const X = (v) => gutter + px(v) * kx;
    for (let r = 0; r < n; r++) {
      const y = sn(top + r * rowH);
      const rh = Math.max(minPx, sn(rowH - 1));
      const row = rows[r] || [];
      for (let i = 0; i < bins; i++) {
        const v = row[i];
        if (v == null) continue;
        const x0 = sn(X(d.start + i * bp));
        const x1 = sn(X(d.start + (i + 1) * bp));
        if (x1 < 0 || x0 > w) continue;
        const k = Math.round(segK(v, amp, N));
        ctx.fillStyle = v >= 0 ? lutG[k] : lutL[k];
        ctx.fillRect(x0, y, Math.max(minPx, x1 - x0), rh);
      }
    }
    if (gutter > 0) {
      // 名称列：不透明底色 + 右侧分隔线，和画布上的轨道名列一个观感
      ctx.fillStyle = C.panel;
      ctx.fillRect(0, 0, gutter, h);
      ctx.fillStyle = C.border;
      ctx.fillRect(gutter - 1 / dpr, 0, 1 / dpr, h);
      ctx.fillStyle = C.text;
      for (let r = 0; r < n; r++) {
        const nm = names[r];
        if (!nm) continue;
        let label = String(nm);
        while (label.length > 4 && ctx.measureText(label).width > gutter - 8) label = label.slice(0, -1);
        if (label !== nm) label = label.slice(0, -1) + '…';
        ctx.fillText(label, 5, top + r * rowH + rowH / 2);
      }
    }
    if (summaryH) drawSegSummary(ctx, w, heatH, summaryH, d, rows, amp, lutG, lutL, N);
    ctx.restore();
    return { amp, n };
  }

  /* 样本为列（转置）：常规 CNV 矩阵的摆法——一列一个样本，纵向是基因组区间。
     行数由像素高度决定，一行像素覆盖多个 bin 时取这些 bin 的均值。 */
  function drawSegHeatCols(ctx, w, h, d, rows, names, amp, lutG, lutL, N) {
    const nS = rows.length;
    const bins = d.bins || (rows[0] || []).length;
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    const top = 13;          // 顶部留给样本名
    const bot = 2;
    const H = Math.max(12, h - top - bot);
    const colW = w / Math.max(1, nS);
    const dpr = S.dpr || 1;
    const sn = (v) => Math.round(v * dpr) / dpr;
    const minPx = 1 / dpr;
    for (let j = 0; j < nS; j++) {
      const row = rows[j] || [];
      const x0 = sn(j * colW);
      const x1 = sn((j + 1) * colW);
      const cw = Math.max(minPx, x1 - x0);   // 列与列之间不留缝，否则整张图看起来像网格
      for (let py = 0; py < H; py++) {
        const b0 = Math.floor((py / H) * bins);
        const b1 = Math.max(b0 + 1, Math.floor(((py + 1) / H) * bins));
        let sum = 0;
        let cnt = 0;
        for (let i = b0; i < b1 && i < bins; i++) {
          const v = row[i];
          if (v != null) { sum += v; cnt++; }
        }
        if (!cnt) continue;
        const v = sum / cnt;
        const k = Math.round(segK(v, amp, N));
        ctx.fillStyle = v >= 0 ? lutG[k] : lutL[k];
        // 行高按设备像素对齐：直接用 minPx 会在 1.5× 屏上留下 1px 白缝
        const y0 = sn(top + py);
        const y1 = sn(top + py + 1);
        ctx.fillRect(x0, y0, cw, Math.max(minPx, y1 - y0));
      }
    }
    // 列名（样本名）画在顶部；列太窄就截断，悬停看全名
    ctx.fillStyle = C.text;
    for (let j = 0; j < nS; j++) {
      const nm = String(names[j] || '');
      if (!nm) continue;
      let label = nm;
      while (label.length > 3 && ctx.measureText(label).width > colW - 4) label = label.slice(0, -1);
      if (label !== nm) label = label.slice(0, -1) + '…';
      ctx.fillText(label, sn(j * colW) + 1, top - 6);
    }
    return { amp, n: nS };
  }

  // 全基因组视野（「全部染色体」）的 SEG 取数：一次拿回所有染色体拼起来的矩阵
  function ensureSegGenome() {
    if (!S.genomeView || !S.asm) return;
    const chroms = primaryChroms().filter((c) => (S.asm.chroms[c] || 0) > 0);
    for (const t of S.bw.list) {
      if (!t.heatmap || !bwActive(t)) continue;
      const d = S.bw.data[t.id];
      if (d && (d.genome || d._gvPending)) continue;
      S.bw.data[t.id] = { genome: true, rows: [], order: [], _gvPending: true };
      api('loaded/seg_genome', { track: t.id, chroms: chroms.join(','), bins: 2400 })
        .then((r) => {
          S.bw.data[t.id] = { genome: true, order: r.order || [], bins: r.bins || 0,
            rows: r.rows || [], samples: r.samples, reason: r.reason || null };
          scheduleRender();
        })
        .catch((err) => {
          S.bw.data[t.id] = { genome: true, rows: [], order: [],
            reason: T('读取失败：') + err.message };
          scheduleRender();
        });
    }
  }

  function clearJunctionTrack(id) {
    for (const [key, req] of S.bw.juncPending || []) {
      if (req.id !== id) continue;
      req.ac.abort();
      S.bw.juncPending.delete(key);
    }
    for (const [key, rec] of S.bw.juncData || []) {
      if (rec.id === id) S.bw.juncData.delete(key);
    }
  }

  function junctionRequestCurrent(req) {
    const t = S.bw.list.find((t) => t.id === req.id);
    const v = req.panel.view;
    return !req.ac.signal.aborted && S.panels.includes(req.panel) && S.asm === req.asm
      && t && t === req.track && bwActive(t) && bwCfg(t.id).junctionVisible && S.bw.juncOn !== false && !S.genomeView
      && (v.end - v.start) <= alignmentVisibility(t)
      && v.chrom === req.chrom && v.start === req.start && v.end === req.end;
  }

  /* Sashimi 剪接弧：窗口内的 junction 画成贝塞尔弧，弧高按跨度、线宽按支持 reads 数 */
  function drawJunctionTracks() {
    const pending = (S.bw.juncPending = S.bw.juncPending || new Map());
    const cache = (S.bw.juncData = S.bw.juncData || new Map());
    for (const [key, req] of pending) {
      if (junctionRequestCurrent(req)) continue;
      req.ac.abort();
      pending.delete(key);
    }
    for (const t of S.bw.list) {
      const el = document.querySelector(`.track[data-junc="${CSS.escape(t.id)}"]`);
      if (!el) continue;
      el.hidden = !bwActive(t) || !bwCfg(t.id).junctionVisible || S.bw.juncOn === false || S.genomeView;
      if (el.hidden) continue;
      const canvas = paneCanvas(el);
      if (!canvas) continue;
      const { ctx, w, h } = fitCanvas(canvas, 64);
      const v = S.view;
      const sub = el.querySelector('.sub');
      if (!v.chrom || (v.end - v.start) > alignmentVisibility(t)) {
        ctx.fillStyle = C.muted; ctx.font = '11.5px system-ui'; ctx.textBaseline = 'middle';
        ctx.fillText(T('放大查看剪接（Zoom in to see junctions）'), 12, h / 2);
        if (sub) sub.textContent = '';
        continue;
      }
      const key = JSON.stringify([S.asm && S.asm.id, S.act, t.id, v.chrom, v.start, v.end]);
      const entry = cache.get(key);
      const rec = entry?.junctions;
      if (!entry) {
        if (!pending.has(key)) {
          const req = { id: t.id, track: t, panel: S.panels[S.act], asm: S.asm,
            chrom: v.chrom, start: v.start, end: v.end, ac: new AbortController() };
          pending.set(key, req);
          const store = (result) => {
            if (pending.get(key) !== req || !junctionRequestCurrent(req)) return;
            cache.set(key, { id: t.id, ...result });
            while (cache.size > 64) cache.delete(cache.keys().next().value);
          };
          api('loaded/junctions', { track: t.id, chrom: v.chrom, s: v.start, e: v.end, min: 1 },
            { signal: req.ac.signal })
            .then((r) => {
              if (r.reason || !Array.isArray(r.junctions)) {
                store({ error: true, reason: r.reason || T('剪接数据格式无效') });
              } else store({ junctions: r.junctions });
            })
            .catch((err) => {
              if (err?.name !== 'AbortError') store({ error: true, reason: T('读取失败：') + err.message });
            })
            .finally(() => {
              if (pending.get(key) !== req) return;
              pending.delete(key);
              if (junctionRequestCurrent(req)) scheduleRender();
            });
        }
        ctx.fillStyle = C.muted; ctx.font = '11.5px system-ui'; ctx.textBaseline = 'middle';
        ctx.fillText(T('读取中…'), 12, h / 2);
        continue;
      }
      if (entry.error || entry.reason) {
        ctx.fillStyle = C.muted; ctx.font = '11.5px system-ui'; ctx.textBaseline = 'middle';
        ctx.fillText(T(entry.reason || '读取失败'), 12, h / 2);
        if (sub) sub.textContent = '';
        continue;
      }
      // 弧带几何移植自 IGV src/main/java/org/igv/renderer/SpliceJunctionRenderer.java:194-234。
      // 深度标尺采用 SpliceJunctionTrack 构造中的 60；保留当前配色，不移植侧翼与交互。
      /* 上游 MIT 许可（保留版权及许可声明）：
       * Copyright (c) 2007-2026 Broad Institute and Regents of the University of California
       * Permission is hereby granted, free of charge, to any person obtaining a copy
       * of this software and associated documentation files (the "Software"), to deal
       * in the Software without restriction, including without limitation the rights
       * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
       * copies of the Software, and to permit persons to whom the Software is
       * furnished to do so, subject to the following conditions:
       * The above copyright notice and this permission notice shall be included in
       * all copies or substantial portions of the Software.
       * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
       * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
       * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
       * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
       * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
       * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
       * THE SOFTWARE.
       */
      const px = (bp) => Math.round(((bp - v.start) / (v.end - v.start)) * w);
      const center = Math.trunc(h / 2);
      const maxHeight = Math.trunc((h - 1) / 2);
      const maxDepth = 60;
      const innerHeight = Math.trunc(maxHeight * 0.33);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      rec.forEach((j) => {
        const x1 = px(j.d), x2 = px(j.a);
        if (x2 < 0 || x1 > w) return;
        const span = Math.max(1, x2 - x1);
        const direction = j.strand === '-' ? 1 : -1;
        const beginY = center + direction;
        const outerHeight = innerHeight + Math.max(1, Math.trunc(0.67 * maxHeight * Math.min(1, j.n / maxDepth)));
        const outerY = beginY + Math.trunc(1.3 * direction * outerHeight);
        const innerY = beginY + Math.trunc(1.3 * direction * innerHeight);
        const xpad = Math.max(1, Math.trunc(span / 30));
        ctx.strokeStyle = j.strand === '-' ? (C.cnvLoss || '#2a6fb0') : (C.cnvGain || '#c0392b');
        ctx.fillStyle = ctx.strokeStyle;
        ctx.globalAlpha = 140 / 255;
        ctx.lineWidth = 1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x1, 0, span, h);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(x1, beginY);
        ctx.bezierCurveTo(x1 - xpad, outerY, x2 + xpad, outerY, x2, beginY);
        ctx.bezierCurveTo(x2 + xpad, innerY, x1 - xpad, innerY, x1, beginY);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
        ctx.restore();
      });
      ctx.globalAlpha = 100 / 255;
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, center);
      ctx.lineTo(w, center);
      ctx.stroke();
      ctx.restore();
      if (sub) sub.textContent = T(`${rec.length} 个剪接位点`);
    }
  }

  function drawBwTracks() {
    for (const t of S.bw.list) {
      const el = document.querySelector(`.track[data-bw="${CSS.escape(t.id)}"]`);
      if (!el) continue;
      // 关掉的轨道整行隐藏。以前只跳过绘制，行还留着，canvas 保持 300×150 的
      // 默认尺寸、被 CSS 的 width:100% 按比例拉成几百像素高的空白块。
      if (!bwActive(t) || (S.genomeView && !t.heatmap)) { el.hidden = true; continue; }
      el.hidden = false;
      const canvas = paneCanvas(el);
      if (!canvas) continue;
      const d = S.bw.data[t.id];
    const cfg = bwCfg(t.id);
      // 多样本 SEG：一行一个样本的热图，轨道高度跟着样本数走
      if (t.heatmap) {
        el.classList.toggle('seg-col', cfg.segLayout === 'col');
        el.classList.toggle('seg-none', cfg.segLayout === 'none');
        const gvMode = !!S.genomeView;
        if (gvMode) ensureSegGenome();
        el.classList.toggle('seg-nonames', !cfg.segNames);
        const nameBox = el.querySelector('.seg-sample-labels');
        if (nameBox) {
          nameBox.replaceChildren();
          if (cfg.segNames) {
            const allNames = (d && d.samples) || t.sampleNames || [];
            const show = segVisible(cfg, allNames.length);
            for (const i of show) {
              const s = document.createElement('div');
              s.className = 'seg-sample-name'; s.textContent = allNames[i] || `#${i + 1}`;
              nameBox.appendChild(s);
            }
            if (show.length && cfg.segSummary !== false) { const sm = document.createElement('div'); sm.className = 'seg-summary-name'; sm.textContent = T('CNV Summary'); nameBox.appendChild(sm); }
          }
        }
        const nAll = Math.max(1, (d && d.rows && d.rows.length) || t.samples || 1);
        // 高度按「勾选上的样本数」算：全部取消勾选时留 1 行的位置显示提示
        const nRow = Math.max(1, segVisible(cfg, nAll).length);
        // 样本为列（转置）时高度固定；样本为行时跟着样本数走；紧凑模式每行更矮
        const rowUnit = cfg.segLayout === 'none' ? 8 : SEG_ROW_H;
        const sumH = cfg.segSummary === false ? 0 : 44;
        const HH = cfg.segLayout === 'col'
          ? 300
          : Math.min(720, Math.max(40, nRow * rowUnit + 8 + sumH));
        const { ctx, w, h } = fitCanvas(canvas, HH);
        const res = gvMode
          ? drawSegGenome(ctx, w, h, t, d, cfg)
          : drawSegHeatmap(ctx, w, h, t, d, cfg);
        const subEl = el.querySelector('.sub');
        if (subEl) {
          subEl.textContent = res.n
            ? T(`${res.n}${res.n < nAll ? `/${nAll}` : ''} 个样本 · ±${formatVal(res.amp)}`)
            : '';
        }
        continue;
      }
      const H = 78;
      const { ctx, w, h } = fitCanvas(canvas, H);
      const sub = el.querySelector('.sub');
      const color = cfg.color;

      if (isBam(t) && (S.view.end - S.view.start) > alignmentVisibility(t)) {
        ctx.fillStyle = C.muted;
        ctx.font = '11.5px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(T('放大查看覆盖度（Zoom in to see coverage）'), 12, h / 2);
        if (sub) sub.textContent = '';
        continue;
      }
      if (!d || !d.values || !d.values.length) {
        // 后端说「这条染色体没有数据」时优先显示原因；空数组也不再走画轴分支，
        // 否则 peak=0 会让轴退化成 0 – 2.0e-9（见 bwRange 的注释）
        ctx.fillStyle = C.muted;
        ctx.font = '11.5px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(d && d.reason ? T(d.reason) : T('读取中…'), 12, h / 2);
        if (sub) sub.textContent = '';
        continue;
      }
      // group members share one axis; otherwise the track uses its own range
      const gr = bwGroupRange(cfg);
      const range = gr || bwRange(t);
      const vals = d.values;
      let lo = range.lo;
      let hi = range.hi;
      if (cfg.log) {
        // log axes cannot start at 0: fall back to the smallest positive bin
        hi = Math.max(hi, 1e-9);
        let minPos = Infinity;
        for (const v of vals) if (v && v.m > 0) minPos = Math.min(minPos, v.m);
        if (!Number.isFinite(minPos)) minPos = hi / 1e4;
        lo = Math.pow(10, Math.floor(Math.log10(Math.max(minPos, hi / 1e6))));
        if (!(lo > 0) || lo >= hi) lo = hi / 1e4;
      }
      // 基线贴着轨道底部：IGV 的 signal track 也是从最底边起画，
      // 之前留了 16px 给「最小值标签」，结果 0 下面空一条（标签本来就画在基线上方）
      const base = h - 2;
      const top = 8;
      const yOf = cfg.log
        ? (v) => {
          const l0 = Math.log10(lo);
          const l1 = Math.log10(hi);
          const lv = Math.log10(Math.max(v, lo));
          return base - ((lv - l0) / ((l1 - l0) || 1)) * (base - top);
        }
        : (v) => {
          const span = (hi - lo) || 1;
          return base - ((clamp(v, lo, hi) - lo) / span) * (base - top);
        };
      const floorY = cfg.log ? base : yOf(clamp(0, lo, hi));

      const n = vals.length;
      const binBp = (d.end - d.start) / n;
      const xOf = (i) => px(d.start + i * binBp);

      // baseline + optional zero line for ranges that straddle 0
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      ctx.moveTo(0, base + 0.5);
      ctx.lineTo(w, base + 0.5);
      ctx.stroke();
      if (!cfg.log && lo < 0 && hi > 0) {
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = C.border;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(yOf(0)) + 0.5);
        ctx.lineTo(w, Math.round(yOf(0)) + 0.5);
        ctx.stroke();
        ctx.restore();
      }

      // bars (IGV 风格)：每个 bin 一根实心柱，fill 与 border 同色。
      // 边界必须对齐到「设备像素」而不是 CSS 像素：CTX 已按 dpr 缩放，若在 CSS 像素上
      // 取整，dpr=1.25/1.5 时边界落在半像素上 → 抗锯齿把两边各算一半覆盖率，
      // 中间出现一条浅色竖缝（看起来像柱子之间有空隙）。按设备像素取整即可严丝合缝。
      ctx.fillStyle = color;
      const dpr = S.dpr || 1;
      const sn = (v) => Math.round(v * dpr) / dpr;
      const minPx = 1 / dpr;
      // 拷贝数：增益红 / 缺失蓝。只在颜色变化时切一次 fillStyle，
      // 免得每个 bin 都做一次字符串比较（几十万 bin 时这点开销看得见）
      const diverging = !!(d.diverging || t.diverging);
      const gainCol = C.cnvGain || '#c0392b';
      const lossCol = C.cnvLoss || '#2a6fb0';
      let curCol = null;
      for (let i = 0; i < n; i++) {
        const v = vals[i];
        if (!v) continue;
        const x0 = sn(xOf(i));
        const x1 = sn(i + 1 < n ? xOf(i + 1) : xOf(n));
        if (x1 < 0 || x0 > w) continue;
        if (diverging) {
          const col = v.m >= 0 ? gainCol : lossCol;
          if (col !== curCol) { ctx.fillStyle = col; curCol = col; }
        }
        const y = yOf(v.m);
        const yTop = sn(Math.min(y, floorY));
        const yBot = sn(Math.max(y, floorY));
        const barH = yBot - yTop;
        if (barH < minPx * 0.5) continue;   // 极小值也至少留半像素
        ctx.fillRect(x0, yTop, Math.max(minPx, x1 - x0), barH);
      }

      // axis labels
      ctx.fillStyle = C.muted;
      ctx.font = '9.5px ui-monospace, Menlo, Consolas, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(formatVal(hi), 4, top + 4);
      ctx.fillText(formatVal(lo), 4, base - 6);
      // 窗口里一个非零 bin 都没有：轴照画（0–1），再补一句提示，
      // 否则一条空轨道看起来像「文件没读进来」
      let anyVal = false;
      for (let i = 0; i < n; i++) {
        // 拷贝数轨道整段缺失时 m 全是负数，用 >0 判断会误报「无信号」
        if (vals[i] && (diverging ? vals[i].m !== 0 : vals[i].m > 0)) { anyVal = true; break; }
      }
      if (!anyVal) {
        ctx.fillStyle = C.muted;
        ctx.font = '11.5px system-ui, sans-serif';
        ctx.fillText(T('该区域无信号'), 44, h / 2);
      }
      if (sub) {
        const bits = [`${formatVal(lo)}–${formatVal(hi)}`];
        if (cfg.mode === 'fixed') bits.push(T('固定'));
        if (cfg.log) bits.push('log');
        if (gr) bits.push(T('共享'));
        sub.textContent = bits.join(' · ');
        sub.style.color = cfg.mode === 'fixed' ? 'var(--accent)' : '';
      }
    }
  }

  /* -------------------------------------------------- BAM 比对视图（reads） */
  // 完整遍历 CIGAR：M/=/X 和 D/N 消耗参考坐标，I/S/H/P 不消耗。
  function cigarSegments(cigar, p0) {
    const blocks = [];
    const gaps = [];
    let ref = p0;
    let cur = null;
    const re = /(\d+)([MIDNSHP=X])/g;
    let m;
    while ((m = re.exec(cigar))) {
      const ln = +m[1];
      const op = m[2];
      if (op === 'M' || op === '=' || op === 'X') {
        if (cur && cur[1] === ref) cur[1] = ref + ln;
        else { cur = [ref, ref + ln]; blocks.push(cur); }
        ref += ln;
      } else if (op === 'D' || op === 'N') {
        gaps.push({ start: ref, end: ref + ln, op });
        ref += ln;
        cur = null;
      }
    }
    return { blocks, gaps };
  }

  // 按最早结束的 lane 复用，坐标有序时为 O(N log depth)，不逐行扫描。
  function packReads(reads, mode = 'expanded') {
    if (mode === 'collapsed' || mode === 'full') {
      const items = reads.map((r, i) => ({ r, lane: mode === 'collapsed' ? 0 : i, segments: cigarSegments(r.c, r.p) }));
      const lanes = mode === 'collapsed' ? (reads.length ? [items] : []) : items.map(item => [item]);
      return { rows: lanes.length, items, lanes };
    }
    let ordered = reads;
    for (let i = 1; i < reads.length; i++) {
      if (reads[i].p < reads[i - 1].p) {
        ordered = reads.slice().sort((a, b) => a.p - b.p);
        break;
      }
    }
    const heap = [];
    const items = [];
    let rows = 0;
    const before = (a, b) => a.end < b.end || (a.end === b.end && a.lane < b.lane);
    for (const r of ordered) {
      let slot;
      if (heap.length && heap[0].end <= r.p) {
        slot = heap[0];
        slot.end = r.e;
        let i = 0;
        while (2 * i + 1 < heap.length) {
          let child = 2 * i + 1;
          if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++;
          if (!before(heap[child], slot)) break;
          heap[i] = heap[child];
          i = child;
        }
        heap[i] = slot;
      } else {
        slot = { end: r.e, lane: rows++ };
        let i = heap.length;
        heap.push(slot);
        while (i > 0) {
          const parent = (i - 1) >> 1;
          if (!before(slot, heap[parent])) break;
          heap[i] = heap[parent];
          i = parent;
        }
        heap[i] = slot;
      }
      items.push({ r, lane: slot.lane, segments: cigarSegments(r.c, r.p) });
    }
    const lanes = Array.from({ length: rows }, () => []);
    for (const item of items) lanes[item.lane].push(item);
    return { rows, items, lanes };
  }

  function scrollAlignmentTrack(e) {
    const track = e.target.closest('.track[data-align]');
    if (!track || e.ctrlKey || e.metaKey || S.genomeView) return false;
    // Consume vertical wheel input even at either end: never zoom or scroll
    // the page unexpectedly while browsing the alignment stack.
    if (!e.deltaY) return false;
    const pane = eventPane(e);
    const P = S.panels[pane.idx];
    const d = P && P.alignData && P.alignData[track.dataset.align];
    e.preventDefault();
    e.stopPropagation();
    if (!d || !d.alignScroll || !d.reads) return true;
    const scroll = d.alignScroll;
    const delta = e.deltaY * (e.deltaMode === 1 ? scroll.rowH : e.deltaMode === 2 ? scroll.height : 1);
    scroll.offset = Math.max(0, Math.min(scroll.max, scroll.offset + delta));
    scheduleRender();
    return true;
  }

  const BASE_COLOR = { A: '#3a9e5f', C: '#3b7dd8', G: '#d08a2e', T: '#c94f4f', N: '#8a8a8a' };

  function drawAlignTracks() {
    const P = S.panels[S.act];
    if (!P.alignData) P.alignData = {};
    for (const t of S.bw.list) {
      const el = document.querySelector(`.track[data-align="${CSS.escape(t.id)}"]`);
      if (!el) continue;
      // 同 drawBwTracks：关掉的比对视图整行隐藏，别留一条空白
      if (!alignActive(t)) { el.hidden = true; continue; }
      el.hidden = false;
      const canvas = paneCanvas(el);
      if (!canvas) continue;
      const sub = el.querySelector('.sub');
      const d = P.alignData[t.id];
      const hint = (txt) => {
        const { ctx, h } = fitCanvas(canvas, 46);
        ctx.fillStyle = C.muted;
        ctx.font = '11.5px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, 12, h / 2);
        if (sub) sub.textContent = '';
      };
      if ((P.view.end - P.view.start) > alignmentVisibility(t)) {
        hint(T('放大查看比对记录（Zoom in to see alignments）'));
        continue;
      }
      if (!d || !d.reads) { hint(d && d.reason ? T(d.reason) : T('读取中…')); continue; }
      if (!d.reads.length) { hint(T(d.reason) || T('该区域没有比对记录')); continue; }

      // Retain all lanes at readable height and render only the scrolled viewport.
      const reads = d.reads;
      const display = bwCfg(t.id).alignDisplay || 'squished';
      if (!d.readLayout || d.readLayout.reads !== reads || d.readLayout.length !== reads.length || d.readLayout.mode !== display) {
        d.readLayout = { reads, length: reads.length, mode: display, packed: packReads(reads, display) };
      }
      const packed = d.readLayout.packed;
      const rows = Math.max(1, packed.rows);
      const maxH = Math.max(120, Math.min(380, Math.round(window.innerHeight * 0.35)));
      const rowH = display === 'squished' ? 5 : ALIGN_ROW_H;
      const H = Math.min(rows * rowH + 8, maxH);
      const { ctx, w, h } = fitCanvas(canvas, H);
      const dpr = S.dpr || 1;
      const sn = (v) => Math.round(v * dpr) / dpr;
      const boxH = rowH - 2;
      const maxScroll = Math.max(0, rows * rowH - (h - 8));
      if (!d.alignScroll || d.alignScroll.layout !== d.readLayout) {
        d.alignScroll = { layout: d.readLayout, offset: 0 };
      }
      const scroll = d.alignScroll;
      scroll.offset = Math.max(0, Math.min(maxScroll, scroll.offset));
      scroll.max = maxScroll;
      scroll.height = h - 8;
      scroll.rowH = rowH;
      const firstRow = Math.floor(scroll.offset / rowH);
      const endRow = Math.min(rows, Math.ceil((scroll.offset + h - 8) / rowH));
      const minPx = 1 / dpr;
      // 按链着色（IGV 的 Color by → strand）；默认全灰，和 IGV 默认一致
      const byStrand = !!bwCfg(t.id).strandColor;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 4, w, h - 8);
      ctx.clip();
      for (let lane = firstRow; lane < endRow; lane++) {
        for (const it of packed.lanes[lane]) {
        const r = it.r;
        const y = 4 + it.lane * rowH - scroll.offset;
        const neg = (r.f & 16) !== 0;
        let fill = C.read;
        if (byStrand) fill = neg ? '#5b7fd4' : '#cf6b6b';
        ctx.fillStyle = fill;
        const segs = it.segments.blocks;
        for (let si = 0; si < segs.length; si++) {
          const x0 = sn(px(segs[si][0]));
          const x1 = sn(px(segs[si][1]));
          if (x1 < -4 || x0 > w + 4) continue;
          const wpx = Math.max(minPx, x1 - x0);
          // IGV 的 read 块是「带箭头的方框」：3′ 端收成三角，指向转录方向
          // （正链朝右、负链朝左）。太窄时画不出箭头，就退化成普通方块。
          const arrow = wpx >= 6 ? Math.min(5, boxH * 0.5) : 0;
          const isHead = neg ? si === 0 : si === segs.length - 1;
          if (!arrow || !isHead) { ctx.fillRect(x0, y, wpx, boxH); continue; }
          if (neg) {
            ctx.fillRect(x0 + arrow, y, wpx - arrow, boxH);
            ctx.beginPath();
            ctx.moveTo(x0 + arrow, y);
            ctx.lineTo(x0, y + boxH / 2);
            ctx.lineTo(x0 + arrow, y + boxH);
            ctx.closePath();
            ctx.fill();
          } else {
            ctx.fillRect(x0, y, wpx - arrow, boxH);
            ctx.beginPath();
            ctx.moveTo(x1 - arrow, y);
            ctx.lineTo(x1, y + boxH / 2);
            ctx.lineTo(x1 - arrow, y + boxH);
            ctx.closePath();
            ctx.fill();
          }
        }
        // 错配：参考坐标 + 1 个碱基宽，最小 2px 才看得见
        if (r.mm && r.mm.length) {
          for (const [off, b] of r.mm) {
            const col = BASE_COLOR[b] || C.text;
            const x = sn(px(r.p + off));
            if (x < -4 || x > w + 4) continue;
            ctx.fillStyle = col;
            ctx.fillRect(x, y, Math.max(2, minPx), boxH);
          }
          ctx.fillStyle = fill;
        }
        // D 用较粗的深色线，N 用细线；坐标来自完整 CIGAR 的参考游标。
        for (const gap of it.segments.gaps) {
          const xa = sn(px(gap.start));
          const xb = sn(px(gap.end));
          if (xb < -4 || xa > w + 4) continue;
          const lineH = Math.min(boxH, gap.op === 'D' ? 1.5 : 0.75);
          ctx.fillStyle = gap.op === 'D' ? C.text : '#96b8c8';
          ctx.fillRect(xa, y + (boxH - lineH) / 2, Math.max(minPx, xb - xa), lineH);
        }
        ctx.fillStyle = fill;
        }
      }
      ctx.restore();
      if (maxScroll > 0) {
        const thumbH = Math.max(18, (h - 8) * (h - 8) / (rows * rowH));
        const thumbY = 4 + scroll.offset / maxScroll * (h - 8 - thumbH);
        ctx.fillStyle = C.muted;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(w - 5, thumbY, 3, thumbH);
        ctx.globalAlpha = 1;
      }

      if (sub) {
        const shown = reads.length;
        const bits = [T(`${shown}${shown !== d.total ? ` / ${d.total}` : ''} 条 read`)];
        if (d.sampled) {
          bits.push(T(`仅返回 ${d.reads.length} / ${d.total} 条（达到上限）`));
        }
        if (maxScroll > 0) bits.push(T(`行 ${firstRow + 1}–${endRow} / ${rows} · 滚轮上下浏览`));
        if (d.hasSeq === false) bits.push(T('无碱基序列'));
        sub.textContent = bits.join(' · ');
      }
    }
  }

  function formatVal(v) {    if (!Number.isFinite(v)) return '—';
    if (v === 0) return '0';
    const a = Math.abs(v);
    const s = v < 0 ? '-' : '';
    if (a >= 1e5 || a < 1e-3) return v.toExponential(1).replace('e+', 'e');
    if (a >= 1000) return s + Math.round(a).toLocaleString('en-US');
    if (a >= 100) return s + a.toFixed(0);
    if (a >= 10) return s + a.toFixed(1);
    if (a >= 1) return s + a.toFixed(2);
    return s + a.toFixed(3);
  }

  function bwValueAt(trackId, x) {
    const d = S.bw.data[trackId];
    if (!d || !d.values) return null;
    const n = d.values.length;
    const binBp = (d.end - d.start) / n;
    const bp = bpAt(x);
    const i = Math.floor((bp - d.start) / binBp);
    if (i < 0 || i >= n) return null;
    return d.values[i];
  }

  /* ------------------------------------------------------------------ status */
  function updateStatus() {
    if (S.genomeView && S.asm) {
      const total = genomeTotalLen();
      $('#stLocus').textContent = `${S.asm.id}  ${T('全基因组')}`;
      $('#stWindow').textContent = `${(total / 1e9).toFixed(2)} Gb`;
      $('#stScale').textContent = T(`${primaryChroms().length} 条染色体`);
      return;
    }
    const { chrom, start, end } = S.view;
    if (!chrom) return;
    const w = trackWidth();
    const bpPerPx = (end - start) / w;
    const tag = S.panels.length > 1 && S.selPane >= 0
      ? T(`  [屏 ${S.selPane + 1}/${S.panels.length}]`) : '';
    $('#stLocus').textContent = `${S.asm.id}  ${chrom}:${fmt(start + 1)}-${fmt(end)}${tag}`;
    const size = end - start;
    $('#stWindow').textContent = size >= 1e6 ? `${(size / 1e6).toFixed(2)} Mb` : `${fmt(size)} bp`;
    $('#stScale').textContent = bpPerPx >= 1 ? `${bpPerPx.toFixed(0)} bp/px` : `${bpPerPx.toFixed(3)} bp/px`;
  }

  /* -------------------------------------------------------------------- info */
  function renderInfo() {
    const box = $('#info');
    const g = S.sel;
    if (!g) {
      box.innerHTML = T('<p class="muted">点击基因查看转录本详情</p>');
      return;
    }
    const rows = g.tx.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const cdsLen = rows.map((t) => t.cdsEnd - t.cdsStart);
    const multi = g.tx.length > 1;
    // selection may come from an imported GTF track, which keeps its own
    // expand state (keyed by track id + gene)
    const ltrack = S.selTrack ? S.loaded.list.find((x) => x.id === S.selTrack) : null;
    const expandedNow = ltrack ? isLoadedExpanded(ltrack, g) : isExpanded(g);
    box.innerHTML = T(`
      <h4>${g.name}</h4>
      <div class="kv"><b>位置</b><span>${g.chrom}:${fmt(g.start + 1)}-${fmt(g.end)}</span></div>
      <div class="kv"><b>链</b><span class="${g.strand === '-' ? 'strand-m' : 'strand-p'}">${g.strand}</span></div>
      <div class="kv"><b>长度</b><span>${fmt(g.end - g.start)} bp</span></div>
      <div class="kv"><b>转录本</b><span>${g.tx.length} 个</span></div>
      ${multi ? T(`<div class="kv expand-row"><span class="link" id="expandToggle">${expandedNow ? T('▾ 收起 ') + g.tx.length + T(' 个转录本') : T('▸ 展开 ') + g.tx.length + T(' 个转录本')}</span></div>`) : ''}
      <table>
        <thead><tr><th>转录本</th><th>外显子</th><th>CDS</th></tr></thead>
        <tbody>${rows.slice(0, 12).map((t, i) => `
          <tr><td>${t.name}</td><td>${t.exons.length}</td><td>${fmt(cdsLen[i])}</td></tr>`).join('')}
        </tbody>
      </table>
      ${rows.length > 12 ? T(`<p class="muted">…共 ${rows.length} 个转录本</p>`) : ''}`);
    const et = box.querySelector('#expandToggle');
    if (et) {
      et.onclick = () => {
        if (ltrack) toggleLoadedExpand(ltrack, g);
        else toggleExpand(g);
      };
    }
  }

  /* ---------------------------------------------------------------------- UI */
  /* ------------------------------------------- 轨道标签列宽度（拖动分隔条） */
  const LABEL_W_DEFAULT = 116;   // P1-3：96 → 116，中文标签 + 副标题不再换行
  const LABEL_W_MIN = 72;
  const LABEL_W_MAX = 420;

  function applyLabelW(w, opts) {
    const view = $('#view');
    if (!view) return;
    // 上限跟着窗口走：再宽也要给画布留一半
    const max = Math.max(LABEL_W_MIN, Math.min(LABEL_W_MAX, Math.round(view.clientWidth * 0.55)));
    const v = Math.max(LABEL_W_MIN, Math.min(max, Math.round(Number(w) || LABEL_W_DEFAULT)));
    S.labelW = v;
    view.style.setProperty('--label-w', v + 'px');
    if (opts && opts.save) savePrefs();
    syncSplitLines();   // 标签列变宽/变窄，分屏竖线的 x 也要跟着走
  }

  // 指针是否压在「标签列 / 画布」的分界线上（±4px）
  function nearLabelEdge(e) {
    const view = $('#view');
    if (!view) return false;
    const r = view.getBoundingClientRect();
    return Math.abs(e.clientX - (r.left + S.labelW)) <= 4;
  }

  function bindLabelResize() {
    const view = $('#view');
    if (!view) return;
    let dragging = false;
    view.addEventListener('mousemove', (e) => {
      if (dragging) return;
      const near = nearLabelEdge(e);
      // 近边缘时压掉标签列上的 grab 光标（见 style.css 的 .view.near-edge）
      view.classList.toggle('near-edge', near);
      view.style.cursor = near ? 'col-resize' : '';
    });
    view.addEventListener('mouseleave', () => {
      view.classList.remove('near-edge');
      if (!dragging) view.style.cursor = '';
    });
    view.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !nearLabelEdge(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      document.body.classList.add('col-resizing');
      const startX = e.clientX;
      const startW = S.labelW;
      const move = (ev) => {
        applyLabelW(startW + (ev.clientX - startX));
        scheduleRender();
      };
      const up = () => {
        dragging = false;
        document.body.classList.remove('col-resizing');
        view.style.cursor = '';
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        savePrefs();
        scheduleRender();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    // 双击分隔线回到默认宽度
    view.addEventListener('dblclick', (e) => {
      if (!nearLabelEdge(e)) return;
      e.preventDefault();
      applyLabelW(LABEL_W_DEFAULT, { save: true });
      scheduleRender();
    });
    window.addEventListener('resize', () => applyLabelW(S.labelW));
  }

  /* ------------------------------------------- 轨道行顺序（在标签列上直接拖动） */
  // 每行一个稳定键：静态轨道 s:<data-track>、信号轨道 bw:<id>、
  // 比对轨道 al:<id>、导入轨道 ld:<id>。只存键，重启后按表重排 DOM。
  function trackKey(el) {
    if (!el) return null;
    if (el.dataset.tkey) return el.dataset.tkey;
    let k = null;
    if (el.dataset.track) k = 's:' + el.dataset.track;
    else if (el.dataset.bw) k = 'bw:' + el.dataset.bw;
    else if (el.dataset.align) k = 'al:' + el.dataset.align;
    else if (el.dataset.junc) k = 'junc:' + el.dataset.junc;
    else if (el.dataset.loaded) k = 'ld:' + el.dataset.loaded;
    else if (el.dataset.motif) k = 'motif:' + el.dataset.motif;
    if (k) el.dataset.tkey = k;
    return k;
  }

  function trackRows() {
    return $$('#view .track');
  }

  function readTrackOrderFromDom() {
    const out = [];
    for (const el of trackRows()) {
      const k = trackKey(el);
      if (k) out.push(k);
    }
    return out;
  }

  // 把 DOM 里刚出现的轨道登记进顺序表：插在「DOM 里它前面最近的已登记轨道」之后。
  // 注意不能在这里剪掉「表里有、DOM 里没有」的键——启动时 applyTrackOrder 先跑，
  // 那时 BAM / 导入轨道还没创建，剪掉就会让它们的行顺序在下次刷新时丢掉。
  function syncTrackOrder() {
    const domKeys = readTrackOrderFromDom();
    const order = S.trackOrder.slice();
    for (let i = 0; i < domKeys.length; i++) {
      const k = domKeys[i];
      if (order.includes(k)) continue;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) {
        const idx = order.indexOf(domKeys[j]);
        if (idx >= 0) { at = idx + 1; break; }
      }
      order.splice(at, 0, k);
    }
    S.trackOrder = order;
  }

  // 按 S.trackOrder 落位（只读：不丢键、不改表）
  function applyTrackOrder() {
    const view = $('#view');
    if (!view) return;
    syncTrackOrder();
    const byKey = new Map();
    for (const el of trackRows()) {
      const k = trackKey(el);
      if (k && !byKey.has(k)) byKey.set(k, el);
    }
    const tail = $('#empty');
    for (const k of S.trackOrder) {
      const el = byKey.get(k);
      if (el) view.insertBefore(el, tail);
    }
    // 保存的旧顺序也必须保持同一 BAM 的 coverage → junction → alignment。
    for (const t of S.bw.list.filter(isBam)) {
      const el = byKey.get('bw:' + t.id);
      const je = byKey.get('junc:' + t.id);
      const ae = byKey.get('al:' + t.id);
      if (el && je) {
        el.after(je);
        if (ae) je.after(ae);
      }
    }
  }

  // 拖动 BAM 的 coverage 行时，「比对」行如果正贴着它，就一起搬走。
  // （用户手动把两行拖开之后就不再绑定，保持「每行自由移动」）
  function dragMate(el) {
    const k = trackKey(el);
    if (!k || k.indexOf('bw:') !== 0) return null;
    const nx = el.nextElementSibling;
    if (nx && nx.classList.contains('track') && nx.dataset.align === k.slice(3)) return nx;
    return null;
  }

  function bindTrackReorder() {
    const view = $('#view');
    if (!view) return;
    let drag = null;

    // 候选落点：除自己（和跟随行）以外的可见行；data-fixed 的行只当参照，不当落点
    const rowsFor = () => trackRows().filter(
      (el) => el !== drag.el && el !== drag.mate && !el.hidden && !el.hasAttribute('data-fixed'));

    view.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (nearLabelEdge(e)) return;                    // 分隔条拖宽优先
      if (!e.target.closest('.track-label')) return;   // 只在第二列（标签列）上拖
      if (e.target.closest('.tgear, button, input, select, textarea, a')) return;
      const el = e.target.closest('.track');
      if (!el || el.hasAttribute('data-fixed')) return;
      const key = trackKey(el);
      if (!key) return;
      drag = { el, key, mate: dragMate(el), y0: e.clientY, x0: e.clientX, on: false };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp, { once: true });
    });

    function onMove(ev) {
      if (!drag) return;
      if (!drag.on) {
        // 超过 4px 才算拖动，否则保留原来的点击（右键菜单 / 齿轮）行为
        if (Math.abs(ev.clientY - drag.y0) < 4 && Math.abs(ev.clientX - drag.x0) < 4) return;
        drag.on = true;
        drag.el.classList.add('trk-dragging');
        if (drag.mate) drag.mate.classList.add('trk-dragging');
        document.body.classList.add('trk-reordering');
      }
      let ref = $('#empty');
      for (const r of rowsFor()) {
        const b = r.getBoundingClientRect();
        if (ev.clientY < b.top + b.height / 2) { ref = r; break; }
      }
      // 已经在位就不要重复 insertBefore，否则行高变化会让落点来回抖
      if (ref !== drag.el.nextElementSibling) view.insertBefore(drag.el, ref);
      if (drag.mate && drag.mate.previousElementSibling !== drag.el) {
        view.insertBefore(drag.mate, drag.el.nextElementSibling);
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      if (!drag) return;
      const moved = drag.on;
      drag.el.classList.remove('trk-dragging');
      if (drag.mate) drag.mate.classList.remove('trk-dragging');
      document.body.classList.remove('trk-reordering');
      drag = null;
      if (!moved) return;
      S.trackOrder = readTrackOrderFromDom();
      savePrefs();
      // 拖完浏览器还会补一个 click（可能落在基因画布上），吃掉它
      const swallow = (ev) => {
        view.removeEventListener('click', swallow, true);
        ev.stopPropagation();
        ev.preventDefault();
      };
      view.addEventListener('click', swallow, true);
      scheduleRender();
    }
  }

  /* ---- shared search-term helpers (used by both search boxes) ----------- */
  // 把「TP53, BRCA1」或「TP53 chr7:55,000,000-55,200,000」拆成多个词；
  // 用正则整体抓 token，避免把 chr7:55,000,000 里的逗号当成分隔符
  function splitTerms(text) {
    const cleaned = String(text).replace(/[，；、+]/g, ',');
    const tokens = cleaned.match(/[A-Za-z0-9_.\-]+(?::[0-9,]+(?:-[0-9,]+)?)?/g) || [];
    return tokens.map((t) => t.trim()).filter(Boolean);
  }

  // 取「正在输入的那一段」（末尾刚敲了分隔符就返回空，等用户接着敲下一个）
  function lastTerm(raw) {
    if (/[,;，；+]\s*$/.test(raw)) return '';
    const terms = splitTerms(raw);
    return terms.length ? terms[terms.length - 1] : '';
  }

  // 选中候选后，把输入框里「还没定下来的最后一段」换成真正的基因名。
  // 用分词重建而不是正则替换，这样 chr1:1,000-2,000 里的千分位逗号不会被误当分隔符。
  function commitTerm(raw, name) {
    const terms = splitTerms(raw);
    if (!/[,;，；+]\s*$/.test(raw)) terms.pop();   // 末段是半截输入，丢掉
    terms.push(name);
    return terms.join(', ');
  }

  /* ---- search scope ----------------------------------------------------
     导入 GTF/GFF 后不再新增第二个搜索框：搜索框左侧出现一个下拉，用来切换
     搜索范围（内置注释 / 全部导入 / 指定轨道）。选择状态不落盘，重启回默认。 */
  let gtfRefresh = null;   // 重新填充范围下拉；轨道变化时调用

  function bindUI() {
    bindLabelResize();
    bindTrackReorder();
    $('#asmBtn').onclick = (e) => {
      e.stopPropagation();
      $('#asmMenu').classList.toggle('open');
    };
    document.addEventListener('click', () => $('#asmMenu').classList.remove('open'));

    /* ---- per-track settings: gear button + right-click ---- */
    $('#view').addEventListener('click', (e) => {
      const gear = e.target.closest('.tgear');
      if (!gear) return;
      e.preventDefault();
      e.stopPropagation();
      openTrackPop(gear, gear.dataset.gear, gear.dataset.bwid);
    }, true);

    $('#view').addEventListener('contextmenu', (e) => {
      const trk = e.target.closest('.track');
      if (!trk) return;
      if (trk.dataset.align) {
        e.preventDefault();
        openTrackPop(trk.querySelector('.track-label'), 'align', trk.dataset.align);
      } else if (trk.dataset.junc) {
        e.preventDefault();
        openTrackPop(trk.querySelector('.track-label'), 'junc', trk.dataset.junc);
      } else if (trk.dataset.bw) {
        e.preventDefault();
        openTrackPop(trk.querySelector('.track-label'), 'bw', trk.dataset.bw);
      } else if (trk.dataset.track === 'genes' || trk.dataset.track === 'gc') {
        e.preventDefault();
        const detail = trk.dataset.track === 'genes' ? geneDetailsForEvent(e) : null;
        openTrackPop(trk.querySelector('.track-label'), trk.dataset.track, undefined, detail);
      } else if (trk.dataset.loaded) {
        const t = S.loaded.list.find((x) => x.id === trk.dataset.loaded);
        if (t && t.kind === 'gene') {
          e.preventDefault();
          openTrackPop(trk.querySelector('.track-label'), 'lgenes', t.id, geneDetailsForEvent(e, t));
        }
      }
    });

    $('#bwList').addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.bw-trk');
      if (!row) return;
      e.preventDefault();
      const id = row.dataset.bwid;
      if (S.bw.sel.size >= 2 && S.bw.sel.has(id)) {
        openBwCtx(e.clientX, e.clientY);
      } else {
        if (!S.bw.sel.has(id)) { S.bw.sel.clear(); S.bw.sel.add(id); renderBwList(); }
        openTrackPop(row, 'bw', id);
      }
    });

    $('#loadedList').addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.loaded-trk');
      if (!row) return;
      e.preventDefault();
      const id = row.dataset.loadedid;
      if (!S.loaded.sel.has(id)) { S.loaded.sel.clear(); S.loaded.sel.add(id); renderLoadedList(); }
      openLoadedCtx(e.clientX, e.clientY);
    });

    document.addEventListener('mousedown', (e) => {
      const pop = $('#tpop');
      if (pop && !pop.hidden) {
        if (!e.target.closest('#tpop') && !e.target.closest('.tgear')) closeTrackPop();
      }
      const ctx = $('#bwCtx');
      if (ctx && !ctx.hidden && !e.target.closest('#bwCtx')) closeBwCtx();
      const lctx = $('#loadedCtx');
      if (lctx && !lctx.hidden && !e.target.closest('#loadedCtx')) closeLoadedCtx();
      const tp = $('#transPop');
      if (tp && !tp.hidden && !e.target.closest('#transPop') && !e.target.closest('.sflip[data-trans]')) {
        closeTransPop();
      }
    });

    $('#view').addEventListener('scroll', () => { closeTrackPop(); closeBwCtx(); closeLoadedCtx(); closeTransPop(); }, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeTrackPop(); closeBwCtx(); closeLoadedCtx(); closeTransPop(); }
    });

    for (const cb of $$('.trk input')) {
      cb.onchange = () => {
        S.tracks[cb.dataset.track] = cb.checked;
        if (cb.dataset.track === 'seq' && cb.checked) ensureAll(true);
        if (cb.dataset.track === 'gc' && cb.checked) ensureAll(true);
        render();
      };
    }

    $('#btnIn').onclick = () => zoomAt(0.5, 0.5);
    $('#btnOut').onclick = () => zoomAt(2, 0.5);
    $('#btnHome').onclick = () => {
      const len = S.asm.chroms[S.view.chrom];
      navigate(S.view.chrom, 0, len);
    };
    $('#btnTheme').onclick = () => {
      applyTheme(S.theme === 'dark' ? 'light' : 'dark');
      render();
    };

    /* ---- 序列轨道：翻转链（同 IGV 序列轨道名字旁的箭头 / Flip strand） ---- */
    if ($('#seqFlip')) {
      $('#seqFlip').setAttribute('aria-pressed', S.seqFlip ? 'true' : 'false');
      $('#seqFlip').onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();   // 别让标签列的拖动/右键接走
        setSeqFlip(!S.seqFlip);
      };
    }
    if ($('#seqTrans')) {
      $('#seqTrans').onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pop = $('#transPop');
        if (pop && !pop.hidden && pop.dataset.key === 'seq') { closeTransPop(); return; }
        openTransPop($('#seqTrans'), 'seq');
      };
    }
    syncTransButtons();

    /* ---- 全基因组总览：展开 / 收起 ---- */
    if ($('#ovToggle')) {
      $('#ovToggle').onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();   // 别让标签列的拖动/右键接走
        S.overviewExpanded = !S.overviewExpanded;
        syncOverviewCtl();
        scheduleRender();
      };
    }

    /* ---- 侧栏：轨道开关折叠 / 染色体 chip 展开（P0-2） ---- */
    for (const [btnId, bodyId] of [['#tracksToggle', '#tracksBody']]) {
      const btn = $(btnId), body = $(bodyId);
      if (!btn || !body) continue;
      btn.onclick = (e) => {
        e.preventDefault();
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        body.hidden = open;
      };
    }

    /* ---- Find motif ---- */
    if ($('#btnMotif')) $('#btnMotif').onclick = () => openMotifDialog();
    if ($('#motifOk')) $('#motifOk').onclick = () => submitMotif();
    if ($('#motifCancel')) $('#motifCancel').onclick = () => closeMotifDialog();
    if ($('#motifX')) $('#motifX').onclick = () => closeMotifDialog();
    if ($('#motifPattern')) {
      $('#motifPattern').addEventListener('input', () => { setMotifErr(''); syncMotifNames(false); });
    }
    for (const sel of ['#motifPos', '#motifNeg']) {
      const el = $(sel);
      if (el) el.addEventListener('input', () => { S.motif.nameTouched = true; });
    }
    if ($('#motifDlg')) {
      const dlg = $('#motifDlg');
      // 点遮罩关闭；Esc 关闭；Ctrl/Cmd+Enter 确定（回车本身留给换行，多行模式要用）
      dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) closeMotifDialog(); });
      dlg.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); closeMotifDialog(); }
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitMotif(); }
      });
    }

    /* ---- 分屏按钮 ---- */
    renderSplitMenu();
    $('#btnSplit').onclick = (e) => {
      e.stopPropagation();
      const menu = $('#splitMenu');
      const exp = $('#expMenu');
      if (exp) exp.hidden = true;
      renderSplitMenu();
      menu.hidden = !menu.hidden;
    };
    document.addEventListener('click', (e) => {
      const menu = $('#splitMenu');
      if (menu && !menu.hidden && !e.target.closest('.split')) menu.hidden = true;
    });

    /* ---- 导出按钮 ---- */
    renderExportMenu();
    $('#btnExport').onclick = (e) => {
      e.stopPropagation();
      const menu = $('#expMenu');
      const wasOpen = !menu.hidden;
      $('#splitMenu').hidden = true;
      renderExportMenu();
      menu.hidden = wasOpen;
    };
    document.addEventListener('click', (e) => {
      const menu = $('#expMenu');
      if (menu && !menu.hidden && !e.target.closest('#expWrap')) menu.hidden = true;
    });

    const input = $('#locus');
    // 搜索范围下拉（自绘菜单，不是原生 <select>，见 style.css 的 .scope-item）
    // 'refseq' 走内置 RefSeq 索引；其它值走 /api/loaded/search
    const scopeBtn = $('#scopeBtn');
    const scopeMenu = $('#scopeMenu');
    const scopeLabel = $('#scopeLabel');
    let scopeVal = 'refseq';
    const scopeLoaded = () => scopeVal !== 'refseq';
    const scopeTrack = () => scopeVal === 'refseq' ? 'all' : scopeVal;
    const geneTracks = () => S.loaded.list.filter((t) => t.kind === 'gene');
    const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // 搜到导入注释里的基因时自动勾上它所在轨道，否则跳过去只看到 RefSeq
    function ensureLoadedTrackOn(tid) {
      if (!tid || S.loaded.on[tid] !== false) return;
      S.loaded.on[tid] = true;
      renderLoadedList();
      ensureLoadedTrackEls();
      scheduleRender();
    }
    let sugTimer = 0;
    let sugHideTimer = 0;
    let sugHits = [];
    let sugSel = -1;

    input.addEventListener('input', () => {
      clearTimeout(sugTimer);
      clearTimeout(sugHideTimer);
      // 旧候选立刻作废：否则切换范围后马上回车，会跳到上一次范围的结果
      sugHits = [];
      sugSel = -1;
      const raw = input.value;
      if (!raw.trim()) { hideSuggest(); return; }
      // 只对「最后一段」做联想，前面的已输入项不参与搜索。
      // 用 splitTerms 分词而不是按逗号切：chr1:1,000,000 的千分位逗号不是分隔符
      const q = lastTerm(raw);
      if (!q) { hideSuggest(); return; }
      sugTimer = setTimeout(async () => {
        try {
          const r = scopeLoaded()
            ? await api('loaded/search', { db: S.asm.id, q, track: scopeTrack() })
            : await api('search', { db: S.asm.id, q });
          sugHits = r.hits || [];
          showSuggest(sugHits, q);
        } catch { /* ignore */ }
      }, 130);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // 输入了多个基因/位置时，回车一律按「多屏」处理，避免被联想候选截胡
        if (splitTerms(input.value.trim()).length > 1) { hideSuggest(); submitLocus(); }
        else if (sugSel >= 0 && sugHits[sugSel]) goHit(sugHits[sugSel]);
        else if (sugHits.length) goHit(sugHits[0]);
        else submitLocus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!sugHits.length) return;
        e.preventDefault();
        sugSel = clamp(sugSel + (e.key === 'ArrowDown' ? 1 : -1), 0, sugHits.length - 1);
        [...$('#suggest').children].forEach((el, i) => el.classList.toggle('sel', i === sugSel));
      } else if (e.key === 'Escape') {
        hideSuggest();
        input.blur();
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.locus-wrap')) hideSuggest();
    });

    function showSuggest(hits, q) {
      const box = $('#suggest');
      if (!hits.length) { hideSuggest(); return; }
      sugSel = -1;
      box.innerHTML = hits.map((h, i) => {
        if (h.type === 'locus') {
          return T(`<div class="sg" data-i="${i}"><span class="k">位置</span>
            <span class="n">${h.label}</span></div>`);
        }
        if (h.type === 'loaded-gene') {
          return T(`<div class="sg" data-i="${i}"><span class="k">GTF</span>
            <span class="n">${escHtml(h.name)}</span>
            <span class="p">${escHtml(h.trackName || '')}${h.trackName ? ' · ' : ''}${escHtml(h.chrom)}:${fmt(h.start + 1)} · ${escHtml(h.strand)}</span></div>`);
        }
        return T(`<div class="sg" data-i="${i}"><span class="k">基因</span>
          <span class="n">${h.name}</span>
          <span class="p">${h.chrom}:${fmt(h.start + 1)} · ${h.strand}</span></div>`);
      }).join('');
      box.hidden = false;
      [...box.children].forEach((el) => {
        el.onclick = () => goHit(hits[+el.dataset.i]);
      });
    }

    function hideSuggest() {
      $('#suggest').hidden = true;
      sugHits = [];
      sugSel = -1;
    }

    function goHit(hit) {
      if (!hit) { hideSuggest(); return; }
      hideSuggest();
      const name = hit.type === 'locus' ? (hit.label || hit.chrom) : hit.name;
      const raw = input.value;
      // 正在输入多个基因（已有分隔符 / 末尾刚敲了逗号）：补全这一段并继续输入
      const multi = splitTerms(raw).length > 1 || /[,;，；+]\s*$/.test(raw);
      input.value = commitTerm(raw, name);
      if (multi) {
        input.value += ', ';
        input.focus();
        return;
      }
      input.blur();
      if (hit.type === 'locus') {
        navigate(hit.chrom, hit.start, hit.end);
      } else if (hit.type === 'loaded-gene') {
        const pad = Math.max(3000, Math.round((hit.end - hit.start) * 0.35));
        navigate(hit.chrom, Math.max(0, hit.start - pad), hit.end + pad);
        ensureLoadedTrackOn(hit.track);
        const provisional = { name: hit.name, chrom: hit.chrom, start: hit.start,
                              end: hit.end, strand: hit.strand, tx: [] };
        S.sel = provisional;
        S.selTrack = hit.track;
        renderInfo();
        scheduleRender();
        // 搜索命中只带基因边界，再取一次完整模型（转录本/外显子）填详情面板
        api('loaded/genes', { track: hit.track, chrom: hit.chrom, s: hit.start, e: hit.end })
          .then((r) => {
            if (S.sel !== provisional) return;   // 用户已经切走了
            const g = (r.genes || []).find((x) => x.name === hit.name);
            if (g) { S.sel = g; renderInfo(); scheduleRender(); }
          })
          .catch(() => { /* 保留临时模型即可 */ });
      } else {
        const pad = Math.max(3000, Math.round((hit.end - hit.start) * 0.35));
        navigate(hit.chrom, hit.start - pad, hit.end + pad);
        S.sel = { name: hit.name, chrom: hit.chrom, start: hit.start, end: hit.end, strand: hit.strand, tx: [] };
        api('gene', { db: S.asm.id, chrom: hit.chrom, name: hit.name, s: hit.start - 5, e: hit.end + 5 })
          .then((r) => { if (r.gene) { S.sel = r.gene; renderInfo(); scheduleRender(); } });
        renderInfo();
      }
    }

    async function resolveTerm(t) {
      const loc = parseLocus(t, S.asm.chroms);
      if (loc) return loc;
      try {
        const r = scopeLoaded()
          ? await api('loaded/search', { db: S.asm.id, q: t, track: scopeTrack() })
          : await api('search', { db: S.asm.id, q: t });
        const hits = r.hits || [];
        const hit = hits.find((h) => h.type === 'gene' || h.type === 'loaded-gene') || hits[0];
        if (!hit) return null;
        if (hit.type === 'locus') return { chrom: hit.chrom, start: hit.start, end: hit.end };
        const pad = Math.max(3000, Math.round((hit.end - hit.start) * 0.35));
        return { chrom: hit.chrom, start: Math.max(0, hit.start - pad), end: hit.end + pad };
      } catch { return null; }
    }

    async function submitLocus() {
      const text = input.value.trim();
      if (!text) return;
      const loc = parseLocus(text, S.asm.chroms);
      if (loc) return navigate(loc.chrom, loc.start, loc.end);

      // 多个基因 / 多个位置（逗号、分号、加号或空格分隔）→ 自动分屏
      const terms = splitTerms(text);
      if (terms.length > 1) {
        const targets = [];
        for (const t of terms.slice(0, 5)) {
          const v = await resolveTerm(t);
          if (!v) { targets.length = 0; break; }
          targets.push(v);
        }
        if (targets.length > 1) {
          hideSuggest();
          input.blur();
          if (S.panels.length !== targets.length) setPanelCount(targets.length);
          for (let i = 0; i < targets.length; i++) {
            const v = targets[i];
            await navigatePanel(i, v.chrom, v.start, v.end, { force: true });
          }
          setActivePanel(0);
          syncPaneHeads();
          scheduleRender();
          toast(T(`${terms.slice(0, targets.length).join(' / ')} → ${targets.length} 屏`));
          return;
        }
      }

      try {
        const r = scopeLoaded()
          ? await api('loaded/search', { db: S.asm.id, q: text, track: scopeTrack() })
          : await api('search', { db: S.asm.id, q: text });
        if (r.hits && r.hits.length) return goHit(r.hits[0]);
      } catch { /* ignore */ }
      toast(T(`未找到「${text}」`));
    }

    input.addEventListener('blur', () => {
      clearTimeout(sugHideTimer);
      sugHideTimer = setTimeout(hideSuggest, 160);
    });

    // 搜索范围下拉：没有导入注释时禁用，只保留「内置」一项
    gtfRefresh = function () {
      if (!scopeBtn) return;
      const tracks = geneTracks();
      const items = [{ v: 'refseq', label: T('内置') }];
      if (tracks.length) {
        items.push({ v: 'all', label: T('全部导入') });
        for (const t of tracks) items.push({ v: t.id, label: t.name });
      }
      if (!items.some((it) => it.v === scopeVal)) scopeVal = 'refseq';
      scopeMenu.innerHTML = items.map((it) =>
        `<div class="scope-item${it.v === scopeVal ? ' cur' : ''}" role="option"` +
        ` aria-selected="${it.v === scopeVal}" data-v="${escHtml(it.v)}">` +
        `<span class="nm">${escHtml(it.label)}</span>` +
        `${it.v === scopeVal ? '<span class="ck">✓</span>' : ''}</div>`).join('');
      const cur = items.find((it) => it.v === scopeVal) || items[0];
      scopeLabel.textContent = cur.label;
      scopeBtn.disabled = tracks.length === 0;
      scopeBtn.title = tracks.length
        ? T('搜索范围：内置注释，或某个导入的 GTF / GFF 注释')
        : T('搜索范围：内置注释（导入 GTF / GFF 后可选导入注释）');
    };
    gtfRefresh();

    // 自绘菜单开合。原生 <select> 的弹层改不了高亮色、弹出还慢，所以自己画
    const scopeOpen = () => scopeMenu && !scopeMenu.hidden;
    function closeScope() {
      if (!scopeOpen()) return;
      scopeMenu.hidden = true;
      scopeBtn.classList.remove('on');
      scopeBtn.setAttribute('aria-expanded', 'false');
    }
    function openScope() {
      if (!scopeBtn || scopeBtn.disabled) return;
      hideSuggest();
      scopeMenu.hidden = false;
      scopeBtn.classList.add('on');
      scopeBtn.setAttribute('aria-expanded', 'true');
      const cur = scopeMenu.querySelector('.scope-item.cur');
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }
    if (scopeBtn && scopeMenu) {
      scopeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (scopeOpen()) closeScope(); else openScope();
      });
      // 键盘也能用：上下键移动、回车确认、Esc 关掉
      scopeBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeScope(); input.focus(); }
        else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !scopeOpen()) {
          e.preventDefault(); openScope();
        }
      });
      scopeMenu.addEventListener('click', (e) => {
        const el = e.target.closest('.scope-item');
        if (!el) return;
        e.stopPropagation();
        closeScope();
        const v = el.dataset.v;
        if (v === scopeVal) { input.focus(); return; }
        scopeVal = v;
        gtfRefresh();
        // 切换范围后先丢掉上一种范围的候选，再按新范围重新联想
        hideSuggest();
        clearTimeout(sugHideTimer);   // 别让输入框失焦时的延迟关闭把新候选吞掉
        if (input.value.trim()) input.dispatchEvent(new Event('input'));
        input.focus();
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#scopeWrap')) closeScope();
      });
    }

    // 染色体下拉（同 IGV 的染色体选择器）：选某条 = 整条染色体，选「全部」= 全基因组视野
    const chromSel = $('#chromSel');
    const chromMenu = $('#chromMenu');
    if (chromSel && chromMenu) {
      const chromOpen = () => !chromMenu.hidden;
      function closeChrom() {
        if (!chromOpen()) return;
        chromMenu.hidden = true;
        chromSel.classList.remove('on');
        chromSel.setAttribute('aria-expanded', 'false');
      }
      function openChrom() {
        renderChromMenu();
        hideSuggest();
        closeScope();
        chromMenu.hidden = false;
        chromSel.classList.add('on');
        chromSel.setAttribute('aria-expanded', 'true');
        const cur = chromMenu.querySelector('.scope-item.cur');
        if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
      }
      chromSel.addEventListener('click', (e) => {
        e.stopPropagation();
        if (chromOpen()) closeChrom(); else openChrom();
      });
      chromSel.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeChrom();
        else if (e.key === 'ArrowDown' && !chromOpen()) { e.preventDefault(); openChrom(); }
      });
      chromMenu.addEventListener('click', (e) => {
        const el = e.target.closest('.scope-item');
        if (!el) return;
        e.stopPropagation();
        closeChrom();
        pickChrom(el.dataset.chrom);
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.chrom-wrap')) closeChrom();
      });
    }

    // ---- view interactions
    const view = $('#view');
    let drag = null;
    let moved = false;

    view.addEventListener('mousedown', (e) => {
      if (e.target.closest('.track-label') || e.target.closest('.ph-in')) return;
      const p = eventPane(e);            // 点哪一屏就操作哪一屏
      if (!p.rect) return;
      if (S.genomeView) return;   // 全基因组视野里没有可平移的单一视口
      // 操作目标跟着指针走；视觉上的「选中」交给 click 决定，这样同一屏再点一次就能取消
      S.act = p.idx;
      drag = { idx: p.idx, x: e.clientX, start: S.view.start, end: S.view.end,
        chrom: S.view.chrom, w: p.rect.width };
      moved = false;
      view.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 2) {
        moved = true;
        // 真拖动 = 明确在这一屏操作，顺手把它选中
        if (S.selPane !== drag.idx) {
          S.selPane = drag.idx;
          paintPaneSel();
          syncPaneHeads();
          updateStatus();
        }
      }
      if (!moved) return;
      const bpPerPx = (drag.end - drag.start) / Math.max(1, drag.w || trackWidth());
      const len = S.asm.chroms[drag.chrom];
      let start = drag.start - dx * bpPerPx;
      const size = drag.end - drag.start;
      start = clamp(start, 0, Math.max(0, len - size));
      S.view = { chrom: drag.chrom, start: Math.round(start), end: Math.round(start + size) };
      scheduleRender();
    });

    window.addEventListener('mouseup', async () => {
      if (!drag) return;
      const wasDrag = moved;
      drag = null;
      view.style.cursor = '';
      if (wasDrag) {
        setTimeout(() => { moved = false; }, 0);
        await ensureData(false);
        scheduleRender();
      }
    });

    const fracAt = (e) => {
      const p = eventPane(e);
      const r = p.rect || visibleTrackBody().getBoundingClientRect();
      return clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
    };

    view.addEventListener('wheel', (e) => {
      if (scrollAlignmentTrack(e)) return;
      if (!S.asm || S.genomeView) return;
      e.preventDefault();
      const idx = eventPane(e).idx;
      withPanel(idx, () => zoomAt(e.deltaY > 0 ? 1.25 : 0.8, fracAt(e)));
    }, { passive: false });

    view.addEventListener('dblclick', (e) => {
      const idx = eventPane(e).idx;
      withPanel(idx, () => zoomAt(0.5, fracAt(e)));
    });

    // click on genes / ideogram
    // click on genes / ideogram；在某一屏的空白处再点一次 = 取消该屏的选择
    view.addEventListener('click', (e) => {
      if (moved) { moved = false; return; }
      const track = e.target.closest('.track');
      if (!track) return;
      if (track.classList.contains('pane-head')) return; // 位置行自己处理选中/取消
      const pp = eventPane(e);
      const rect = pp.rect || track.querySelector('.track-body').getBoundingClientRect();
      const x = e.clientX - rect.left;
      const name = track.dataset.track;
      let acted = false;                    // 这一下点击已经做了别的动作（命中基因/跳转）就不再切换选中
      const end = () => { if (!acted) togglePane(pp.idx); };
      if (name === 'genome') {
        // 全基因组视野：点哪条染色体就进哪条（同 IGV）
        const slot = genomeHit(x);
        if (slot) pickChrom(slot.name);
        acted = true;
        return end();
      }
      if (name === 'ideogram') {
        // 分屏后每屏是自己那条染色体：按「点到的那一屏」的染色体长度换算坐标
        const P = S.panels[pp.idx] || S.panels[S.act];
        if (!P) return end();
        const len = S.asm.chroms[P.view.chrom];
        const bp = (x / rect.width) * len;
        const size = P.view.end - P.view.start;
        withPanel(pp.idx, () => navigate(P.view.chrom, bp - size / 2, bp + size / 2));
        acted = true;
        return end();
      }
      if (name === 'overview') {
        // 折叠态：点条带任意处 → 展开全览（不跳染色体）；展开态：点某一行 → 跳染色体
        if (!S.overviewExpanded) {
          S.overviewExpanded = true; syncOverviewCtl(); scheduleRender(); acted = true; return end();
        }
        const chrom = overviewHit(e.clientY - rect.top);
        if (!chrom) return end();
        // 分屏后每屏一条总览：按「点到的那一屏」跳转
        withPanel(pp.idx, () => {
          const size = S.view.end - S.view.start;
          const len = S.asm.chroms[chrom];
          if (chrom === S.view.chrom) {
            const bp = (x / rect.width) * len;
            navigate(chrom, bp - size / 2, bp + size / 2);
          } else {
            navigate(chrom, Math.max(0, len * 0.5 - size / 2), Math.min(len, len * 0.5 + size / 2));
          }
        });
        acted = true;
        return end();
      }
      if (name === 'genes') {
        const my = e.clientY - rect.top;
        const tk = expandHit(x, my);
        if (tk) {
          const g = S.data.genes.find((gg) => geneKey(gg) === tk);
          if (g) { S.sel = g; S.selTrack = null; toggleExpand(g); acted = true; return end(); }
        }
        const hit = geneAt(x, my);
        S.sel = hit || null;
        S.selTrack = null;
        acted = Boolean(hit);
        renderInfo();
        scheduleRender();
      }
      // imported GTF / GFF track: same expand behaviour as the RefSeq track
      const lid = track.dataset.loaded;
      if (lid) {
        const t = S.loaded.list.find((x2) => x2.id === lid);
        if (t && t.kind === 'gene') {
          const my = e.clientY - rect.top;
          const tk = loadedToggleHit(t.id, x, my, pp.idx);
          if (tk) {
            const g = placedForPane(t, pp.idx).map((p) => p.g).find((gg) => loadedGeneKey(t, gg) === tk);
            if (g) {
              S.sel = withViewChrom(g); S.selTrack = t.id; toggleLoadedExpand(t, g);
              acted = true; return end();
            }
          }
          const hit = loadedGeneAt(t, x, my, pp.idx);
          S.sel = hit ? withViewChrom(hit) : null;
          S.selTrack = hit ? t.id : null;
          acted = Boolean(hit);
          renderInfo();
          scheduleRender();
        }
        return end();
      }
      end();
    });

    view.addEventListener('mousemove', (e) => {
      if (!S.asm) return;
      const track = e.target.closest('.track');
      const tip = $('#tip');
      if (!track || drag) { tip.hidden = true; return; }
      const pp = eventPane(e);
      const rect = pp.rect || track.querySelector('.track-body').getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < 0 || x > rect.width) { tip.hidden = true; return; }
      const my = e.clientY - rect.top;
      // 全基因组视野：悬停显示染色体名 + 长度
      if (S.genomeView) {
        const slot = genomeHit(x);
        if (!slot) { tip.hidden = true; return; }
        tip.textContent = `${slot.name} · ${(slot.len / 1e6).toFixed(1)} Mb`;
        tip.hidden = false;
        tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 12) + 'px';
        tip.style.top = (e.clientY + 16) + 'px';
        return;
      }
      // 只在被悬停的那块面板的上下文里做命中计算（不改活动面板）
      const info = withPanel(pp.idx, () => {
        const bp = Math.floor(bpAt(x));
        let extra = '';
        if (track.dataset.track === 'genes') {
          const hit = geneAt(x, my);
          if (hit) {
            let s = `  ${hit.name}${hit.strand === '-' ? ' ←' : ' →'}`;
            const ti = txIndexAt(hit, my);
            if (ti != null) s += `  · ${hit.tx[ti].name}`;
            extra = s;
          }
        } else if (track.dataset.loaded) {
          const t = S.loaded.list.find((x2) => x2.id === track.dataset.loaded);
          if (t && t.kind === 'gene') {
            const hit = loadedGeneAt(t, x, my, pp.idx);
            if (hit) {
              let s = `  ${hit.name}${hit.strand === '-' ? ' ←' : ' →'}`;
              const tx = loadedTxAt(t, x, my, pp.idx);
              if (tx) s += `  · ${tx.name}`;
              extra = s;
            }
          }
        } else if (track.dataset.motif) {
          // motif 轨道：鼠标压到某个位点上时显示匹配到的序列和链方向
          const t = S.motif.list.find((x2) => x2.id === track.dataset.motif);
          const rec = t ? S.motif.cache[motifKey(t, S.view)] : null;
          if (rec && rec.hits) {
            const h = rec.hits.find((hh) => hh.strand === t.strand && bp >= hh.s && bp < hh.e);
            if (h) extra = `  ${h.match}${h.strand === '-' ? '  ←' : '  →'}  (${fmt(h.e - h.s)} bp)`;
          }
        } else if (track.dataset.bw) {
          const v = bwValueAt(track.dataset.bw, x);
          if (v) {
            const d = S.bw.data[track.dataset.bw];
            const binBp = (d.end - d.start) / d.values.length;
            const b0 = Math.round(d.start + Math.floor((bpAt(x) - d.start) / binBp) * binBp);
            extra = `  ${track.dataset.bw} = ${formatVal(v.m)}`
              + T(`  (峰值 ${formatVal(v.x)})  [${fmt(b0 + 1)}–${fmt(Math.round(b0 + binBp))}]`);
          }
        }
        if (track.dataset.track === 'genes') {
          const text = geneFeatureHoverText(geneDetailsAt(x, my));
          if (text) extra = '\n' + text;
        } else if (track.dataset.loaded) {
          const annotation = S.loaded.list.find(t => t.id === track.dataset.loaded && t.kind === 'gene');
          if (annotation) {
            const text = geneFeatureHoverText(geneDetailsAt(x, my, annotation, pp.idx));
            if (text) extra = '\n' + text;
          }
        }
        return { bp, extra, chrom: S.view.chrom };
      });
      tip.textContent = `${info.chrom}:${fmt(info.bp + 1)}${info.extra}`;
      tip.hidden = false;
      tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 12) + 'px';
      tip.style.top = (e.clientY + 16) + 'px';
    });

    view.addEventListener('mouseleave', () => { $('#tip').hidden = true; });

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const mdlg = $('#motifDlg');
      if (mdlg && !mdlg.hidden) return;   // 对话框打开时不抢方向键 / 缩放键
      const size = S.view.end - S.view.start;
      if (e.key === 'ArrowLeft') { e.preventDefault(); navigate(S.view.chrom, S.view.start - size * 0.35, S.view.end - size * 0.35); }
      if (e.key === 'ArrowRight') { e.preventDefault(); navigate(S.view.chrom, S.view.start + size * 0.35, S.view.end + size * 0.35); }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(0.5, 0.5); }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(2, 0.5); }
      if (e.key === '/') { e.preventDefault(); $('#locus').focus(); $('#locus').select(); }
      if (e.key === 'Escape') { S.sel = null; renderInfo(); scheduleRender(); }
    });

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { scheduleRender(); }, 80);
    });
  }

  function expandHit(x, y) {
    if (!S._geneToggles) return null;
    for (const t of S._geneToggles) {
      if (x >= t.x - 2 && x <= t.x + t.w + 2 && y >= t.y - 2 && y <= t.y + t.h + 2) return t.key;
    }
    return null;
  }

  // which transcript sub-row is under y for an expanded gene
  function txIndexAt(hit, y) {
    if (!isExpanded(hit) || !hit.tx || hit.tx.length <= 1) return null;
    const { placed } = geneLayout();
    const p = placed.find((pp) => pp.g === hit);
    if (!p) return null;
    for (let i = 0; i < p.span; i++) {
      const cy = 6 + (p.r + i) * ROW_H + ROW_H / 2;
      if (Math.abs(cy - y) < ROW_H / 2) return i;
    }
    return null;
  }

  function geneAt(x, y) {
    const { placed, showLabel, w, maxRows } = geneLayout();
    let best = null;
    let bestDist = 1e9;
    // 标签几何必须按绘制顺序整屏重放一遍再判命中：避让会让标签相对「只看自己」时
    // 左右移动，不复用同一份占位表就会出现「看得到却点不中」。
    const occByRow = new Map();
    const occFor = (r) => {
      let a = occByRow.get(r);
      if (!a) occByRow.set(r, a = []);
      return a;
    };
    for (const p of placed) {
      if (p.r >= maxRows) continue;
      if (p.expanded) {
        // expanded: hit-test each transcript row against its own extent + label
        for (let i = 0; i < p.span; i++) {
          if (p.r + i >= maxRows) break;
          const t = p.txl[i];
          const cy = 6 + (p.r + i) * ROW_H + ROW_H / 2;
          const tx1 = px(t.start);
          const tx2 = px(t.end);
          const text = (i === 0) ? `${p.label}  ·  ${t.name}` : `${t.name}`;
          let spot = null;
          if (showLabel) {
            spot = rowLabelSpot(text, {
              x1: tx1, x2: tx2, w, tgl: i === 0 ? p.tgl : null, occ: occFor(p.r + i),
            });
            if (spot) occFor(p.r + i).push([spot.x, spot.x + spot.tw]);
          }
          if (Math.abs(cy - y) >= ROW_H / 2) continue;
          let hit = x >= tx1 - 4 && x <= tx2 + 2;
          if (!hit && spot) hit = x >= spot.x - 2 && x <= spot.x + spot.tw + 2;
          if (hit) {
            const d = Math.abs(cy - y);
            if (d < bestDist) { best = p.g; bestDist = d; }
          }
        }
        continue;
      }
      const cy = 6 + p.r * ROW_H + ROW_H / 2;
      let lx = null;
      let ltw = 0;
      if (showLabel) {
        const occ = occFor(p.r);
        const reg = labelRegion(p.x2, p.x1, p.tgl, w, occ);
        if (reg) {
          const fit = fitText(p.label, reg.clipRight - reg.clipLeft);
          lx = fit ? (reg.rightAlign ? reg.clipRight - fit.tw : reg.clipLeft) : reg.clipLeft;
          ltw = fit ? fit.tw : textWidth(p.label, GENE_FONT);
          occ.push([lx, lx + ltw]);
        }
      }
      if (Math.abs(cy - y) >= ROW_H / 2) continue;
      let hit = x >= p.x1 - 4 && x <= p.x2 + 2;
      if (!hit && lx !== null) hit = x >= lx - 2 && x <= lx + ltw;
      if (hit) {
        const d = Math.abs(cy - y);
        if (d < bestDist) { best = p.g; bestDist = d; }
      }
    }
    return best;
  }

  async function zoomAt(factor, anchor) {
    const size = S.view.end - S.view.start;
    const len = S.asm.chroms[S.view.chrom];
    let newSize = clamp(Math.round(size * factor), 40, len);
    const anchorBp = S.view.start + size * anchor;
    let start = Math.round(anchorBp - newSize * anchor);
    start = clamp(start, 0, Math.max(0, len - newSize));
    await navigate(S.view.chrom, start, start + newSize);
  }

  function applyTheme(name) {
    S.theme = name;
    document.body.dataset.theme = name;
    readColors();
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* ------------------------------------------------------------- 导入文件 */
  const KIND_LABEL = { signal: T('信号'), gene: T('注释'), seq: T('序列') };

  /* ---- 导入进度面板：上传 → 解析 → 完成 ---- */
  let impEls = null;
  function impDom() {
    if (!impEls) {
      impEls = { panel: $('#impPanel'), name: $('#impName'),
                 bar: $('#impBar'), status: $('#impStatus'), ico: $('#impIco') };
      const x = $('#impX');
      if (x) x.onclick = () => { if (impEls.panel) impEls.panel.hidden = true; };
    }
    return impEls;
  }

  let impTimer = 0;
  const fmtBytes = (n) => n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB'
    : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB'
    : n >= 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B';

  function impShow(name) {
    const d = impDom();
    if (!d.panel) return;
    clearTimeout(impTimer);
    d.panel.hidden = false;
    d.panel.classList.remove('done', 'err', 'indet');
    d.name.textContent = name;
    d.bar.style.width = '0%';
    d.ico.textContent = '↑';
    d.status.textContent = T('准备上传…');
  }
  function impUpload(frac, text) {
    const d = impDom();
    if (!d.panel) return;
    d.panel.classList.remove('indet', 'done', 'err');
    d.ico.textContent = '↑';
    d.bar.style.width = Math.max(2, Math.min(100, Math.round(frac * 100))) + '%';
    if (text) d.status.textContent = text;
  }
  function impProcessing(text) {
    const d = impDom();
    if (!d.panel) return;
    d.panel.classList.add('indet');
    d.panel.classList.remove('done', 'err');
    d.ico.textContent = '⋯';
    d.bar.style.width = '38%';
    d.status.textContent = text || T('正在解析 / 建立索引…');
  }
  function impDone(text) {
    const d = impDom();
    if (!d.panel) return;
    d.panel.classList.remove('indet', 'err');
    d.panel.classList.add('done');
    d.ico.textContent = '✓';
    d.bar.style.width = '100%';
    d.status.textContent = text || T('导入完成');
    impTimer = setTimeout(() => { d.panel.hidden = true; }, 3200);
  }
  function impError(text) {
    const d = impDom();
    if (!d.panel) return;
    d.panel.classList.remove('indet', 'done');
    d.panel.classList.add('err');
    d.ico.textContent = '!';
    d.bar.style.width = '100%';
    d.status.textContent = text || T('导入失败');
    impTimer = setTimeout(() => { d.panel.hidden = true; }, 6000);
  }

  // XHR 上传：能拿到字节级进度；请求体发完（upload.onload）就进入「解析中」，
  // 服务端解析完成才回包 —— 这样大 GTF 在 10–30 秒的解析期间不会「没反应」。
  function uploadOne(file, hooks) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `api/load?name=${encodeURIComponent(file.name)}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && hooks && hooks.upload) hooks.upload(e.loaded / e.total);
      };
      xhr.upload.onload = () => { if (hooks && hooks.processing) hooks.processing(); };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
          // 一个 SEG 里可能装了多个样本 → 后端返回 tracks 数组
          // reused：同一个文件之前已导入过，后端复用了原轨道（不再生成 xxx_2 副本）
          resolve({
            tracks: data.tracks && data.tracks.length ? data.tracks : (data.track ? [data.track] : []),
            reused: !!data.reused,
          });
        } else reject(new Error(data.error || `HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error(T('网络错误')));
      xhr.send(file);
    });
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let ok = 0;
    const fails = [];
    const imported = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const label = files.length > 1 ? `(${i + 1}/${files.length}) ${f.name}` : f.name;
      impShow(label);
      try {
        const res = await uploadOne(f, {
          upload: (frac) => impUpload(frac, T(`上传中 ${Math.round(frac * 100)}% · ${fmtBytes(f.size)}`)),
          processing: () => impProcessing(T('已上传，正在解析 / 建立索引…（大文件可能需要 10–30 秒）')),
        });
        const tracks = res.tracks;
        ok++;
        for (const t of tracks) if (t.id) imported.push(t.id);
        const first = tracks[0] || {};
        let extra = '';
        if (first.heatmap && first.samples > 1) {
          // 多样本 SEG：一条轨道，画成热图
          extra = T(` · ${first.samples} 个样本`) + T(` · ${fmt(first.segments)} 个区间`);
        } else if (first.genes) extra = T(` · ${fmt(first.genes)} 个基因`);
        else if (first.segments) extra = T(` · ${fmt(first.segments)} 个区间`);
        else if (first.features) extra = T(` · ${fmt(first.features)} 个区间`);
        // 同一个文件拖两次：复用原轨道，别在列表里堆两行同名轨道
        impDone(res.reused
          ? T(`${first.name || f.name} 之前已导入，已定位到原轨道`)
          : T(`已导入 ${first.name || f.name}${extra}`));
      } catch (e) {
        fails.push(`${f.name}: ${e.message}`);
        impError(`${f.name}：${e.message}`);
      }
    }
    await loadBwTracks();
    // 刚导入的轨道直接勾上：否则列表里已经排到第 6 条以后时它默认是关的，
    // 用户会以为「导入没成功」
    let touched = false;
    for (const id of imported) {
      if (S.bw.on[id] !== undefined) {
        S.bw.on[id] = true;
        rememberBwOn(id, true);
        touched = true;
      }
    }
    if (touched) { renderBwList(); ensureBwTrackEls(); ensureAll(true); }
    await loadLoadedTracks();
    // 失败要说清楚是哪个文件：一次导入多个时只报第一个，用户根本不知道另一个为什么没出来
    if (fails.length) {
      const extra = fails.length > 2 ? `（共 ${fails.length} 个）` : '';
      toast(T(`导入 ${ok} 个，失败：${fails.slice(0, 2).join('；')}${extra}`));
    } else if (files.length > 1) toast(T(`已导入 ${ok} 个文件`));
  }

  async function loadLoadedTracks(opts) {
    const fresh = !!(opts && opts.fresh);
    let tracks = [];
    try { tracks = (await api('loaded')).tracks || []; } catch { /* ignore */ }
    // signal tracks already live in the bigWig panel; keep gene + seq here
    S.loaded.list = tracks.filter((t) => t.kind !== 'signal');
    S.loaded.data = {};
    S.loaded._pending = {};
    for (const t of S.loaded.list) {
      // 导入的注释 / 序列轨道默认打开：重开软件时全关着，用户会以为导入丢了
      if (S.loaded.on[t.id] === undefined) S.loaded.on[t.id] = true;
    }
    const sec = $('#loadedSec');
    if (sec) sec.hidden = S.loaded.list.length === 0;
    renderLoadedList();
    ensureLoadedTrackEls();
    if (S.asm && S.asm.custom) refreshCustomChroms();
    // show/hide the GTF gene search box + refresh its track picker
    if (gtfRefresh) gtfRefresh();
    scheduleRender();
  }

  function renderLoadedList() {
    const box = $('#loadedList');
    if (!box) return;
    box.innerHTML = '';
    for (const t of S.loaded.list) {
      const el = document.createElement('div');
      el.className = 'trk loaded-trk' + (S.loaded.sel.has(t.id) ? ' sel' : '');
      el.dataset.loadedid = t.id;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'on';
      cb.checked = S.loaded.on[t.id] !== false;
      cb.onchange = (e) => {
        S.loaded.on[t.id] = e.target.checked;
        ensureLoadedTrackEls();
        scheduleRender();
      };
      const sw = document.createElement('span');
      sw.className = 'sw';
      sw.style.background = t.kind === 'gene'
        ? (geneTint(t.id).plus || 'var(--plus)') : '#4a6fa5';
      sw.onclick = (e) => toggleLoadedSelect(t.id, e);
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = t.name;
      nm.title = T(`${t.name}\n${KIND_LABEL[t.kind] || t.kind} · ${t.format} · ${t.chroms} 条染色体`);
      nm.onclick = (e) => toggleLoadedSelect(t.id, e);
      const badge = document.createElement('span');
      badge.className = 'grp';
      badge.textContent = KIND_LABEL[t.kind] || t.kind;
      const rm = document.createElement('button');
      rm.className = 'loaded-x';
      rm.textContent = '×';
      rm.title = T('移除该轨道');
      rm.onclick = async (e) => {
        e.stopPropagation();
        try {
          await fetch(`api/loaded?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' });
          S.loaded.sel.delete(t.id);
          toast(T(`已移除 ${t.name}`));
          await loadLoadedTracks();
        } catch (err) { toast(T('移除失败：') + err.message); }
      };
      el.append(cb, sw, nm, badge, rm);
      box.appendChild(el);
    }
  }

  function toggleLoadedSelect(id, e) {
    if (e) e.stopPropagation();
    const sel = S.loaded.sel;
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      if (sel.has(id)) sel.delete(id); else sel.add(id);
    } else if (sel.size === 1 && sel.has(id)) {
      sel.clear();
    } else {
      sel.clear(); sel.add(id);
    }
    renderLoadedList();
  }

  function closeLoadedCtx() {
    const m = $('#loadedCtx');
    if (m) m.hidden = true;
  }

  function openLoadedCtx(x, y) {
    closeTrackPop();
    closeBwCtx();
    const menu = $('#loadedCtx');
    if (!menu) return;
    menu.innerHTML = '';
    const ids = [...S.loaded.sel];
    const head = document.createElement('div');
    head.className = 'ctx-head';
    head.textContent = T(`已选 ${ids.length} 条导入轨道`);
    menu.appendChild(head);
    menu.appendChild(ctxItem(T('清除选择'), () => { S.loaded.sel.clear(); renderLoadedList(); closeLoadedCtx(); }));
    const sep = document.createElement('div');
    sep.className = 'ctx-sep';
    menu.appendChild(sep);
    menu.appendChild(ctxItem(T(`删除选中的 ${ids.length} 条轨道`), () => loadedDelete(ids), { danger: true }));
    menu.hidden = false;
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    let left = x + 2;
    if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - 2);
    let top = y;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  // 批量删除导入的轨道：调 DELETE /api/loaded（服务端会删除 data/loaded 下的副本文件）
  async function loadedDelete(ids) {
    if (!ids.length) { closeLoadedCtx(); return; }
    const names = ids.map((id) => {
      const t = S.loaded.list.find((x) => x.id === id);
      return t ? t.name : id;
    });
    if (!confirm(T(`确定删除选中的 ${ids.length} 条导入轨道？\n· ${names.join('\n· ')}\n\n对应文件会从 data/loaded 中删除。`))) return;
    closeLoadedCtx();
    // 先从界面/状态移除，渲染器才不会继续为这些轨道发 genes/seq 请求占满连接
    const gone = new Set(ids);
    S.loaded.list = S.loaded.list.filter((t) => !gone.has(t.id));
    for (const id of ids) {
      S.loaded.sel.delete(id);
      S.loaded.flip.delete(id);
      S.trans.loaded.delete(id);
      delete S.trans.loadedTable[id];
      delete S.loaded.on[id];
      delete S.loaded.data[id];
      delete S.loaded.tint[id];
    }
    renderLoadedList();
    ensureLoadedTrackEls();
    scheduleRender();
    // 再并发删除服务端副本（并发可避免串行时被连接池排队卡住）
    let ok = 0;
    await Promise.all(ids.map(async (id) => {
      try {
        const r = await fetch(`api/loaded?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (r.ok) ok++;
      } catch (err) { toast(T('删除失败：') + err.message); }
    }));
    await loadLoadedTracks();
    toast(T(`已删除 ${ok} 条导入轨道`));
  }

  function ensureLoadedTrackEls() {
    const view = $('#view');
    if (!view) return;
    // 导入轨道直接挂在 #view 下（以前塞在 #loadedTracks 里，没法拖到它前面）
    for (const old of $$('#view .track[data-loaded]')) old.remove();
    const anchor = view.querySelector('.track[data-track="overview"]') || $('#empty');
    for (const t of S.loaded.list) {
      if (S.loaded.on[t.id] === false) continue;
      const el = document.createElement('div');
      el.className = 'track';
      el.dataset.loaded = t.id;
      const label = document.createElement('div');
      label.className = 'track-label';
      label.textContent = t.id;
      label.title = t.name || t.id;   // 列宽不够时悬停看全名
      const sub = document.createElement('div');
      sub.className = 'sub';
      label.appendChild(sub);
      if (t.kind === 'gene') {
        const gear = document.createElement('button');
        gear.className = 'tgear';
        gear.dataset.gear = 'lgenes';
        gear.dataset.bwid = t.id;
        gear.title = T('轨道设置');
        gear.textContent = '⚙';
        label.appendChild(gear);
      } else if (t.kind === 'seq') {
        // 导入的 FASTA 也支持 Flip strand（同 RefSeq 序列轨道）
        const fl = document.createElement('button');
        fl.className = 'sflip';
        fl.dataset.seqflip = t.id;
        fl.setAttribute('aria-pressed', S.loaded.flip.has(t.id) ? 'true' : 'false');
        fl.title = T('翻转链：显示互补链（同 IGV 序列轨道的 Flip strand）');
        fl.innerHTML = SEQ_FLIP_SVG;
        fl.addEventListener('click', (e) => {
          e.stopPropagation();
          setLoadedSeqFlip(t.id, !S.loaded.flip.has(t.id));
        });
        label.appendChild(fl);
        // 氨基酸翻译：开关按轨道独立（data-transid 标明是哪条轨道）
        const tr = document.createElement('button');
        tr.className = 'sflip s2';
        tr.dataset.trans = '1';
        tr.dataset.transid = t.id;
        tr.textContent = 'Aa';
        tr.addEventListener('click', (e) => {
          e.stopPropagation();
          const pop = $('#transPop');
          if (pop && !pop.hidden && pop.dataset.key === t.id) { closeTransPop(); return; }
          openTransPop(tr, t.id);
        });
        label.appendChild(tr);
      }
      const body = document.createElement('div');
      body.className = 'track-body';
      body.dataset.split = '1';
      body.appendChild(document.createElement('canvas'));
      el.append(label, body);
      view.insertBefore(el, anchor);
    }
    applyTrackOrder();
    syncTransButtons();
  }

  function drawLoadedTracks() {
    S._loadedToggles = [];
    for (const t of S.loaded.list) {
      if (S.loaded.on[t.id] === false) continue;
      const el = document.querySelector(`.track[data-loaded="${CSS.escape(t.id)}"]`);
      if (!el) continue;
      const canvas = paneCanvas(el);
      if (!canvas) continue;
      if (t.kind === 'gene') drawLoadedGeneTrack(t, canvas, el);
      else if (t.kind === 'seq') drawLoadedSeqTrack(t, canvas, el);
    }
  }

  // lazily fetch + cache the loaded track payload for the current window
  function loadedCache(t) {
    // 缓存按「面板 + 轨道」分键：不同分屏视口各自请求各自的范围
    const pid = S.act;
    const key = `${pid}:${t.id}`;
    const c = S.loaded.data[key];
    const need = { chrom: S.view.chrom, start: S.view.start, end: S.view.end };
    if (c && c.chrom === need.chrom && c.start <= need.start && c.end >= need.end) return c;
    if (!S.loaded._pending[key]) {
      S.loaded._pending[key] = true;
      const params = { db: S.asm.id, track: t.id, chrom: need.chrom, s: need.start, e: need.end };
      api(t.kind === 'gene' ? 'loaded/genes' : 'loaded/seq', params)
        .then((r) => { S.loaded.data[key] = { chrom: need.chrom, start: need.start, end: need.end, ...r }; })
        .catch((e) => { S.loaded.data[key] = { chrom: need.chrom, start: need.start, end: need.end, error: e.message }; })
        .finally(() => { S.loaded._pending[key] = false; scheduleRender(); });
    }
    return (c && c.chrom === need.chrom && c.start <= need.start && c.end >= need.end) ? c : null;
  }

  /* ------------------------------------------- 导入 GTF 注释轨道（可展开） */
  const LROW = 20;

  // 重复注释（RepeatMasker）在低倍视野下一个窗口就有几万个拷贝，逐个画元件
  // 必然糊成一片（还会把画布撑到几万像素高），超过这个缩放就切成密度带。
  // 200 bp/px ≈ 156 kb 窗口：再往外一个 300 bp 的元件已经不到 1.5 px 了。
  const REPEAT_FEATURE_BP_PER_PX = 200;
  const REPEAT_DENSITY_BINS = 800;

  function loadedRepeatDensity(t) {
    const pid = S.act;
    const key = `rep:${pid}:${t.id}`;
    const c = S.loaded.data[key];
    const need = { chrom: S.view.chrom, start: S.view.start, end: S.view.end };
    const ok = c && c.chrom === need.chrom && c.start <= need.start && c.end >= need.end;
    if (ok) return c;
    if (!S.loaded._pending[key]) {
      S.loaded._pending[key] = true;
      api('loaded/repeats', {
        db: S.asm.id, track: t.id, chrom: need.chrom, s: need.start, e: need.end,
        bins: REPEAT_DENSITY_BINS,
      })
        .then((r) => { S.loaded.data[key] = { chrom: need.chrom, start: need.start, end: need.end, ...r }; })
        .catch((e) => { S.loaded.data[key] = { chrom: need.chrom, start: need.start, end: need.end, error: e.message }; })
        .finally(() => { S.loaded._pending[key] = false; scheduleRender(); });
    }
    return null;
  }

  function drawRepeatDensity(t, canvas, el) {
    const sub = el.querySelector('.sub');
    const { ctx, w, h } = fitCanvas(canvas, 46);
    t._placedByPane = t._placedByPane || {};
    t._placedByPane[S.act] = [];      // 密度带没有可点选的元件
    const d = loadedRepeatDensity(t);
    if (!d || !d.bins) {
      ctx.fillStyle = C.muted;
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(d && d.error ? T('读取失败：') + d.error : T('读取中…'), 12, h / 2);
      if (sub) sub.textContent = '';
      return;
    }
    const vals = d.bins;
    const n = vals.length;
    const top = 7;
    const bot = h - 7;
    const max = Math.max(1, d.max || 1);
    const bw = w / n;
    ctx.fillStyle = geneTint(t.id).plus;
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < n; i++) {
      const v = vals[i];
      if (!v) continue;
      const hgt = Math.max(1, (v / max) * (bot - top));
      ctx.fillRect(i * bw, bot - hgt, Math.max(1, bw - 0.3), hgt);
    }
    ctx.globalAlpha = 1;
    if (sub) sub.textContent = T(`${fmt(d.total)} 个 · 密度`);
  }

  function loadedGeneKey(t, g) {
    return `${t.id}|${g.name || g.start}|${g.strand || ''}`;
  }
  // GTF may name chromosomes "8" (Ensembl) while the view uses "chr8"
  function withViewChrom(g) {
    return Object.assign({}, g, { chrom: S.view.chrom });
  }
  function isLoadedExpanded(t, g) {
    const k = loadedGeneKey(t, g);
    return S.loaded.expandAll.has(t.id) ? !S.loaded.collapsed.has(k) : S.loaded.expanded.has(k);
  }
  function toggleLoadedExpand(t, g) {
    const k = loadedGeneKey(t, g);
    if (S.loaded.expandAll.has(t.id)) {
      if (S.loaded.collapsed.has(k)) S.loaded.collapsed.delete(k); else S.loaded.collapsed.add(k);
    } else if (S.loaded.expanded.has(k)) {
      S.loaded.expanded.delete(k);
    } else {
      S.loaded.expanded.add(k);
    }
    savePrefs();
    renderInfo();
    scheduleRender();
  }

  // union of [start,end] runs (GTF exons arrive per transcript)
  function unionIv(list) {
    const a = list.filter((iv) => iv && iv[1] > iv[0]).slice().sort((p, q) => p[0] - q[0]);
    const out = [];
    for (const [s, e] of a) {
      const last = out[out.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else out.push([s, e]);
    }
    return out;
  }

  // arrow head at the 3' end: right for '+', left for '-'
  // 尖端要探出特征末端（压在块上的部分和块同色，靠露在外面那截才看得出方向）
  function drawStrandArrow(ctx, x1, x2, cy, color, w, dir) {
    if (x2 - x1 < 6) return;
    const LEN = 7.5, HH = 4.5;
    const x = dir < 0 ? clamp(x1, 3, w - 3) : clamp(x2, 3, w - 3);
    if (x < 2 || x > w - 2) return;
    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(x + LEN * dir, cy);
    ctx.lineTo(x, cy - HH);
    ctx.lineTo(x, cy + HH);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // row packing for a loaded gene track (expanded genes reserve one row per tx)
  // 重复注释（RepeatMasker / rmsk）一条染色体上就有几十万个拷贝，密度远高于
  // 基因：标签门槛要收得更紧，否则一屏几百个名字会把行数撑到上千行。
  const REPEAT_LABEL_BP_PER_PX = 40;
  const REPEAT_MAX_ROWS = 12;      // 重复轨道行数上限（低倍下就是一串密点，不必铺满）
  const LOADED_MAX_ROWS = 60;      // 其他注释轨道的兜底上限

  function loadedGeneLayout(t, d) {
    const w = trackWidth();
    const bpPerPx = (S.view.end - S.view.start) / w;
    const showLabel = bpPerPx < (t.repeat ? REPEAT_LABEL_BP_PER_PX : 3000);
    const maxRows = t.repeat ? REPEAT_MAX_ROWS : LOADED_MAX_ROWS;
    const rowsEnd = [];
    const placed = [];
    const genes = ((d && d.genes) || []).slice().sort((a, b) => a.start - b.start);
    const collapsed = geneCollapsed(t.id);
    // 折叠模式（默认）：第 0 行画全部基因，被展开的基因从第 1 行往下排
    if (collapsed) rowsEnd.push(Infinity);
    let visible = 0;
    for (const g of genes) {
      if (rowsEnd.length > maxRows) break;
      const x1 = px(g.start), x2 = px(g.end);
      // 缓存里可能是**比当前视野更宽**的一批元件（放大时直接复用上一级缓存）。
      // 完全在视野外的不参与排版：否则 x2 是很大的负数，rowLabelSpot 的
      // max(0, x2)+5 会把它们的名字全挤到画布左边缘，看着像「只有名字没有结构」。
      if (x2 < -4 || x1 > w + 4) continue;
      visible++;
      const txl = (g.tx || []).filter(Boolean);
      const multi = txl.length > 1;
      const expanded = multi && isLoadedExpanded(t, g);
      // expanded: only transcripts that actually intersect the view get a row,
      // otherwise off-screen transcripts leave blank lines with stray labels
      const rows = expanded
        ? txl.filter((tx) => tx.end > S.view.start && tx.start < S.view.end)
        : txl;

      let tgl = null;
      if (multi && (!collapsed || expanded)) {
        const TGL = 12, GAP = 4;
        if (Math.max(0, x2) + GAP + TGL <= w - 2) tgl = { x: Math.max(0, x2) + GAP, w: TGL, h: TGL, left: false };
        else tgl = { x: Math.max(2, x1 - GAP - TGL), w: TGL, h: TGL, left: true };
      }

      const span = expanded ? Math.max(1, rows.length) : 1;
      let lwText = String(g.name || '');
      if (expanded) {
        for (const tx of rows) {
          const s = String(tx.name || '');
          if (s.length > lwText.length) lwText = s;
        }
      }
      // +12 是给「gene · transcript」分隔符和字形两侧留的余量
      const lw = showLabel ? Math.min(170, textWidth(lwText, GENE_FONT) + 12) : 0;
      const tglReserve = tgl && !tgl.left ? tgl.w + 8 : 0;
      const need = Math.max(x2, x1 + 3) + lw + tglReserve;
      // 折叠模式：没展开的基因统一放第 0 行（同 RefSeq 的 collapsed）
      if (collapsed && !expanded) {
        placed.push({ g, x1, x2, r: 0, span: 1, tgl, expanded: false, txl, rows, labels: [] });
        continue;
      }
      const minGap = tgl && tgl.left ? 18 : 6;
      // never negative: a gene crossing the left edge has x1 < 0 and an empty
      // row (rowsEnd 0) must always be placeable, otherwise this loops forever
      const rowLimit = Math.max(0, x1 - minGap);
      let r = 0;
      let guard = 0;
      while (true) {
        while (rowsEnd.length < r + span) rowsEnd.push(0);
        let conflict = false;
        for (let k = 0; k < span; k++) {
          if (rowsEnd[r + k] > rowLimit) { conflict = true; break; }
        }
        if (!conflict) break;
        r++;
        if (++guard > 5000) break;
      }
      while (rowsEnd.length < r + span) rowsEnd.push(0);
      for (let k = 0; k < span; k++) rowsEnd[r + k] = need;
      placed.push({ g, x1, x2, r, span, tgl, expanded, txl, rows, labels: [] });
    }
    return { placed, rows: Math.max(1, rowsEnd.length), w, showLabel, visible };
  }

  // Where does a per-transcript row label go? Right of its own feature when
  // there is room (never under the +/- toggle), else right-aligned just left of
  // it, else nowhere. Shared by the renderer and the hit tester.
  // o.occ: 本行已放过的标签 [x0,x1] 列表。密集区域里两个基因会挤在同一行，
  // 不避让就会叠成 "ACTBENSG00000301444" 这种糊字（典型：ACTB 里套着假基因）。
  function rowLabelSpot(text, o) {
    const tw = textWidth(text, GENE_FONT);
    const occ = o.occ || null;
    const clash = (x) => {
      if (!occ) return null;
      for (const iv of occ) if (x + tw > iv[0] - 4 && x < iv[1] + 4) return iv;
      return null;
    };
    let rightStart = Math.max(0, o.x2) + 5 + ARROW_PAD;
    if (o.tgl && !o.tgl.left) rightStart = Math.max(rightStart, o.tgl.x + o.tgl.w + 4);
    // 优先放特征右侧；被本行已有标签挡住就右移到空隙里，放不下再试左侧
    let x = rightStart;
    for (let guard = 0; guard < 24; guard++) {
      if (o.w - 4 - x < tw) break;
      const hit = clash(x);
      if (!hit) return { x, tw };
      x = hit[1] + 8;
    }
    const lx = Math.min(o.x1 - 8 - ARROW_PAD - tw, o.w - tw - 4);
    if (o.x1 - 8 - ARROW_PAD >= tw + 2 && lx >= 0 && !clash(lx)) return { x: lx, tw };
    return null;
  }

  function drawRowLabel(ctx, spot, text, color, cy, w) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, cy - 9, w, 18);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillText(text, spot.x, cy + 0.5);
    ctx.restore();
  }

  // draw a label at the first free spot (right of feature, else left, else none)
  function drawLoadedLabel(ctx, text, color, cy, o) {
    const spot = rowLabelSpot(text, o);
    if (!spot) return null;
    drawRowLabel(ctx, spot, text, color, cy, o.w);
    if (o.occ) o.occ.push([spot.x, spot.x + spot.tw]);
    return { x: spot.x, tw: spot.tw, cy };
  }

  function drawLoadedGeneTrack(t, canvas, el) {
    // 重复注释：低倍视野切成密度带，避免几万个拷贝把画布撑爆
    if (t.repeat) {
      const bpPerPx = (S.view.end - S.view.start) / trackWidth();
      if (bpPerPx > REPEAT_FEATURE_BP_PER_PX) { drawRepeatDensity(t, canvas, el); return; }
    }
    const d = loadedCache(t);
    const sub = el.querySelector('.sub');
    // 每个面板各自的放置结果，避免分屏时被「最后一个面板」覆盖（否则点 +/− 命中不了）
    const setPlaced = (arr) => { t._placedByPane = t._placedByPane || {}; t._placedByPane[S.act] = arr; };

    if (!d || !d.genes) {
      const H = 38;
      const { ctx, w, h } = fitCanvas(canvas, H);
      setPlaced([]);
      ctx.fillStyle = C.muted;
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(d && d.error ? T('读取失败：') + d.error : T('读取中…'), 12, h / 2);
      if (sub) sub.textContent = '';
      return;
    }
    if (!d.genes.length) {
      const H = 38;
      const { ctx, w, h } = fitCanvas(canvas, H);
      setPlaced([]);
      ctx.fillStyle = C.muted;
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(T('此区域无注释'), 12, h / 2);
      if (sub) sub.textContent = T('0 个基因');
      return;
    }

    const lay = loadedGeneLayout(t, d);
    // 缓存可能是更宽的窗口，按**视野内**的数量报数（否则 30 bp 视野会显示 96 个）
    if (!lay.visible) {
      const { ctx, w, h } = fitCanvas(canvas, 38);
      setPlaced([]);
      ctx.fillStyle = C.muted;
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(T('此区域无注释'), 12, h / 2);
      if (sub) sub.textContent = T('0 个基因');
      return;
    }
    const { ctx, w, h } = fitCanvas(canvas, Math.max(38, lay.rows * LROW + 12));
    setPlaced(lay.placed);
    if (sub) sub.textContent = T(`${d.truncated ? '≥ ' : ''}${lay.visible} 个基因`);
    ctx.textBaseline = 'middle';

    const pal = geneTint(t.id);
    // 每行一个占位表：同一行可能塞好几个基因（小假基因套在大基因里），
    // 标签必须互相避让，否则会叠成一团糊字
    const occByRow = new Map();
    const occFor = (r) => {
      let a = occByRow.get(r);
      if (!a) occByRow.set(r, a = []);
      return a;
    };
    for (const p of lay.placed) {
      const g = p.g;
      const dir = g.strand === '-' ? -1 : 1;
      const color = strandColor(pal, g.strand);
      const selected = S.sel && S.selTrack === t.id && S.sel.name === g.name &&
        S.sel.start === g.start && S.sel.end === g.end;
      p.labels.length = 0;

      if (p.expanded) {
        for (let i = 0; i < p.span; i++) {
          const tx = p.rows[i];
          if (!tx) continue;
          const cy = 6 + (p.r + i) * LROW + LROW / 2;
          const tx1 = px(tx.start), tx2 = px(tx.end);
          drawBackbone(ctx, tx1, tx2, cy, color, w);
          const cds = tx.cdsEnd > tx.cdsStart ? [[tx.cdsStart, tx.cdsEnd]] : [];
          const exons = (tx.exons && tx.exons.length) ? tx.exons : [[tx.start, tx.end]];
          const segs = drawExons(ctx, exons, cds, cy, color, pal);
          drawChevrons(ctx, tx1, tx2, cy, color, w, dir, segs);
          drawStrandArrow(ctx, tx1, tx2, cy, color, w, dir);
        }
      } else {
        const cy = 6 + p.r * LROW + LROW / 2;
        const txl = p.txl;
        const exons = unionIv(txl.flatMap((x) => x.exons || []));
        const cds = unionIv(txl.map((x) => [x.cdsStart, x.cdsEnd]));
        drawBackbone(ctx, p.x1, p.x2, cy, color, w);
        const segs = drawExons(ctx, exons.length ? exons : [[g.start, g.end]], cds, cy, color, pal);
        drawChevrons(ctx, p.x1, p.x2, cy, color, w, dir, segs);
        drawStrandArrow(ctx, p.x1, p.x2, cy, color, w, dir);
      }

      // selection highlight
      if (selected) {
        const bx = Math.max(0, p.x1 - 1);
        const bxe = Math.min(w, p.x2 + 1);
        if (bxe > bx) {
          const top = 6 + p.r * LROW - 2;
          ctx.fillStyle = C.accent;
          ctx.globalAlpha = 0.10;
          ctx.fillRect(bx, top, bxe - bx, p.span * LROW + 4);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = C.accent;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(bx + 0.5, top + 0.5, bxe - bx - 1, p.span * LROW + 3);
          ctx.lineWidth = 1;
        }
      }

      ctx.font = GENE_FONT;
      if (lay.showLabel) {
        if (p.expanded) {
          for (let i = 0; i < p.span; i++) {
            const tx = p.rows[i];
            if (!tx) continue;
            const cy = 6 + (p.r + i) * LROW + LROW / 2;
            const tx1 = px(tx.start), tx2 = px(tx.end);
            const nm = String(tx.name || '');
            const text = i === 0 ? `${g.name || ''}  ·  ${nm}` : nm;
            const spot = drawLoadedLabel(ctx, text, i === 0 ? (selected ? C.accent : C.text) : C.dim, cy,
              { x1: tx1, x2: tx2, w, tgl: i === 0 ? p.tgl : null, occ: occFor(p.r + i) });
            if (spot) p.labels.push(spot);
          }
        } else {
          const cy = 6 + p.r * LROW + LROW / 2;
          // 名字后面不再拼链向字形（→ / ←）：框内雪佛龙 + 3′ 三角箭头已经表达
          // 方向，内置 RefSeq 轨道与展开态也都只靠图形，这里保持同一套视觉。
          const spot = drawLoadedLabel(ctx, String(g.name || ''), selected ? C.accent : C.text, cy,
            { x1: p.x1, x2: p.x2, w, tgl: p.tgl, occ: occFor(p.r) });
          if (spot) p.labels.push(spot);
        }
      }

      // expand / collapse toggle
      if (p.tgl) {
        const cy = 6 + p.r * LROW + LROW / 2;
        const txx = p.tgl.x;
        const tyy = cy - p.tgl.h / 2;
        const tsz = p.tgl.w;
        ctx.fillStyle = selected ? C.accent : C.muted;
        ctx.globalAlpha = 0.92;
        ctx.strokeStyle = selected ? C.accent : C.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(txx + 0.5, tyy + 0.5, tsz, tsz);
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.expanded ? '−' : '+', txx + tsz / 2, cy + 0.5);
        ctx.textAlign = 'left';
        S._loadedToggles.push({ track: t.id, x: txx, y: tyy, w: tsz, h: p.tgl.h, key: loadedGeneKey(t, g) });
      }
    }
  }

  // 某面板里这条轨道的放置结果（分屏时按被点/被悬停的那一屏取，不是活动面板）
  function placedForPane(t, pid) {
    const by = t._placedByPane || {};
    return by[pid] || by[S.act] || [];
  }

  // which gene of a loaded track sits under (x,y) — uses the boxes from the last draw
  function loadedGeneAt(t, x, y, pid) {
    const placed = placedForPane(t, pid);
    let best = null;
    let bestDist = 1e9;
    for (const p of placed) {
      for (let i = 0; i < p.span; i++) {
        const cy = 6 + (p.r + i) * LROW + LROW / 2;
        if (Math.abs(cy - y) >= LROW / 2) continue;
        const tx = p.expanded ? p.rows[i] : null;
        const x1 = tx ? px(tx.start) : p.x1;
        const x2 = tx ? px(tx.end) : p.x2;
        let hit = x >= x1 - 6 && x <= x2 + 6;
        if (!hit) {
          for (const sp of p.labels) {
            if (Math.abs(sp.cy - cy) < 1 && x >= sp.x - 2 && x <= sp.x + sp.tw + 2) { hit = true; break; }
          }
        }
        if (!hit) continue;
        const dd = Math.abs(cy - y);
        if (dd < bestDist) { best = p.g; bestDist = dd; }
      }
    }
    return best;
  }

  function loadedToggleHit(tid, x, y, pid) {
    for (const b of (S.panels[pid] ? S.panels[pid].ltoggles : S._loadedToggles) || []) {
      if (b.track !== tid) continue;
      if (x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2) return b.key;
    }
    return null;
  }

  // transcript under (x,y) inside an expanded loaded gene (for tooltips)
  function loadedTxAt(t, x, y, pid) {
    for (const p of placedForPane(t, pid)) {
      if (!p.expanded) continue;
      for (let i = 0; i < p.span; i++) {
        const cy = 6 + (p.r + i) * LROW + LROW / 2;
        if (Math.abs(cy - y) >= LROW / 2) continue;
        const tx = p.rows[i];
        if (!tx) continue;
        const tx1 = px(tx.start), tx2 = px(tx.end);
        if (x >= tx1 - 6 && x <= tx2 + 6) return tx;
      }
    }
    return null;
  }

  function drawLoadedSeqTrack(t, canvas, el) {
    const bpPerPx = (S.view.end - S.view.start) / trackWidth();
    const show = bpPerPx <= 1.2;
    const cellW = 1 / bpPerPx;
    // 翻译开关按轨道独立：内置序列轨道开着不代表这条导入轨道也开
    const transOn = show && transOnFor(t.id) && cellW >= 3;
    const BASE_H = 22;
    const { ctx, w, h } = fitCanvas(canvas, (show ? BASE_H : 26) + (transOn ? AA_H : 0));
    const sub = el.querySelector('.sub');
    if (!show) {
      ctx.fillStyle = C.muted; ctx.font = '11.5px system-ui, sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillText(T('放大到 ≤1.2 bp/px 显示碱基'), 12, h / 2);
      if (sub) sub.textContent = T('需放大');
      return;
    }
    const d = loadedCache(t);
    if (!d || d.seq == null) {
      ctx.fillStyle = C.muted; ctx.font = '11.5px system-ui, sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillText(d && d.error ? T('读取失败：') + d.error : T('读取中…'), 12, h / 2);
      if (sub) sub.textContent = '';
      return;
    }
    const palette = { A: '#3a9e5f', C: '#3b7dd8', G: '#d08a2e', T: '#c94f4f', N: '#999999' };
    ctx.textBaseline = 'middle';
    const seq = d.seq;
    // Flip strand：逐位取互补，坐标不动（与 RefSeq 序列轨道同一语义）
    const flip = loadedSeqFlipped(t);
    // 碱基必须画在「格子中心」，与内置 RefSeq 序列轨道一致；
    // 画在格子左边缘会整体错开半个格宽，两条轨道上下对不齐。
    const drawLetter = cellW >= 8;
    const seqY = BASE_H / 2;   // 碱基带固定在顶部 22 px 内，翻译行接在下面
    if (drawLetter) {
      ctx.font = `600 ${Math.min(13, Math.max(9, cellW - 2))}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textAlign = 'center';
    }
    for (let i = 0; i < seq.length; i++) {
      const x = px(d.start + i);
      if (x + cellW < -2 || x > w + 2) continue;
      const ch = flip ? complementBase(seq[i]) : seq[i];
      const color = palette[ch.toUpperCase()] || C.text;
      ctx.fillStyle = color;
      if (drawLetter) {
        ctx.fillText(ch, x + cellW / 2, seqY);
      } else {
        ctx.globalAlpha = ch.toUpperCase() === 'N' ? 0.35 : 0.75;
        ctx.fillRect(x, seqY - 5, Math.max(1, cellW + 0.4), 10);
        ctx.globalAlpha = 1;
      }
    }
    ctx.textAlign = 'left';
    if (transOn) drawAminoAcids(ctx, seq, d.start, w, cellW, BASE_H - 1, flip, transTableFor(t.id));
    if (sub) sub.textContent = flip ? T(`互补链 · ${seq.length} bp`) : `FASTA · ${seq.length} bp`;
  }

  /* 从本地绝对路径挂载：不做上传、不复制文件。
     BAM 旁边的 .bai / .csi 由服务端自动接管（add_local 里找同目录索引），
     所以用户只要给一个 .bam 路径就能走「按需随机读取」的快路径。 */
  function promptLocalPath() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.38);display:flex;'
      + 'align-items:center;justify-content:center;z-index:9999';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--panel);border:1px solid var(--border);border-radius:10px;'
      + 'padding:14px 16px;width:min(620px,92vw);display:flex;flex-direction:column;gap:10px;'
      + 'box-shadow:0 12px 40px rgba(0,0,0,.35)';
    const head = document.createElement('div');
    head.style.cssText = 'font:600 13px system-ui;color:var(--text)';
    head.textContent = T('从本地路径挂载');
    const tip = document.createElement('div');
    tip.style.cssText = 'font:11.5px/1.5 system-ui;color:var(--muted)';
    tip.textContent = T('填文件的绝对路径（.bam / .bw / .seg / .gtf …）。不会复制文件；BAM 同目录下的 .bai 会自动用上。');
    const inp = document.createElement('input');
    inp.placeholder = 'C:////data////sample.bam';
    inp.style.cssText = 'width:100%;box-sizing:border-box;padding:7px 9px;font:12px ui-monospace;'
      + 'border:1px solid var(--border);border-radius:6px;background:var(--canvas-bg);color:var(--text)';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    const mk = (label, primary) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'padding:6px 14px;border-radius:6px;font:12.5px system-ui;cursor:pointer;'
        + (primary
          ? 'border:1px solid var(--accent);background:var(--accent);color:#fff'
          : 'border:1px solid var(--border);background:transparent;color:var(--text-dim)');
      return b;
    };
    const cancel = mk(T('取消'), false);
    const ok = mk(T('挂载'), true);
    const err = document.createElement('div');
    err.style.cssText = 'font:11.5px system-ui;color:#c0392b;min-height:14px';
    const close = () => wrap.remove();
    cancel.onclick = close;
    wrap.onclick = (e) => { if (e.target === wrap) close(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') close(); };
    const go = async () => {
      const path = inp.value.trim();
      if (!path) { err.textContent = T('请输入文件路径'); return; }
      ok.disabled = true; ok.textContent = T('挂载中…'); err.textContent = '';
      try {
        const r = await fetch(`api/load_local?db=${encodeURIComponent(S.asm.id)}&path=${encodeURIComponent(path)}`,
          { method: 'POST' });
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        close();
        await loadBwTracks();
        await loadLoadedTracks();
        await ensureAll(true);
        const t0 = (j.tracks && j.tracks[0]) || j.track || {};
        toast(T(`已挂载 ${t0.name || path}`));
      } catch (e) {
        err.textContent = T('挂载失败：') + (e.message || e);
        ok.disabled = false; ok.textContent = T('挂载');
      }
    };
    ok.onclick = go;
    row.append(cancel, ok);
    box.append(head, tip, inp, err, row);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    setTimeout(() => inp.focus(), 30);
  }

  /* ---------------------------------------------------- 导入入口（绑定） */
  (function bindImport() {
    const btn = $('#btnImport');
    const input = $('#fileInput');
    if (btn && input) {
      btn.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        importFiles(input.files).finally(() => { input.value = ''; });
      });
    }
    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      document.body.classList.add('dropping');
    });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) document.body.classList.remove('dropping');
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      document.body.classList.remove('dropping');
      importFiles(e.dataTransfer.files);
    });
  })();

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
