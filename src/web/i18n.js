/* Orbit — 界面语言（中文 / English）
 *
 * 设计取舍：字典以「中文原文」为键。好处是调用处只多一层 t(...)，
 * 中文仍是源码里的唯一事实来源；漏翻时 t() 原样返回中文，不会出现空白或 key。
 *
 *   t('轨道')                     → 'Tracks'
 *   t(`载入 ${ms} ms`)            → 命中 RULES 里的模式 → 'Loaded in 12 ms'
 *
 * 静态 HTML（index.html）不写 data-i18n 属性，启动时由 applyDom() 按同一份
 * 字典替换文本节点与 title / placeholder / aria-label——少改一处是一处。
 * 动态文案由 app.js 在拼接处调用 t()。
 *
 * 切换语言直接 reload：分屏布局在 sessionStorage 里，刷新会原样恢复，
 * 比手工重刷每个 DOM 节点可靠得多。
 */
(function (global) {
  'use strict';

  var STORE_KEY = 'orbit.lang';

  var lang = 'zh';
  try {
    if (localStorage.getItem(STORE_KEY) === 'en') lang = 'en';
  } catch (e) { /* private mode */ }

  /* ---------------------------------------------------------------- 词典 */
  var EN = {
    /* —— 启动 / 装配 —— */
    '无法连接本地服务：': 'Cannot reach the local service: ',
    'data/catalog.json 为空，请先运行构建脚本': 'data/catalog.json is empty — run the build script first',
    '序列·联网': 'sequence · remote',
    '序列已内置': 'sequence bundled',
    '仅注释': 'annotation only',
    ' 基因': ' genes',
    '无注释': 'no annotation',
    '此装配未内置序列（data/genomes 里没有对应 .2bit）':
      'No bundled sequence for this assembly (no matching .2bit in data/genomes)',

    /* —— 搜索 / 分屏 —— */
    '搜索基因 / 位置': 'Search gene / locus',
    '输入基因名或位置后回车：TP53 / chr17:7,660,000-7,690,000':
      'Type a gene or locus, then Enter: TP53 / chr17:7,660,000-7,690,000',
    '关闭这一屏': 'Close this panel',
    '多位置分屏：同时看多个基因': 'Split view: several loci side by side',
    '单视图': 'single view',
    '并排': 'side by side',
    '点某一屏成为活动面板后，搜索框/键盘只作用于该屏；也可在「位置」行直接输入基因名。':
      'Click a panel to make it active — the search box and keyboard then act on that panel only. You can also type a gene name in the Locus row.',
    '分屏后每屏独立导航，可同时看多个基因。':
      'Each panel navigates independently, so you can follow several genes at once.',

    /* —— 通用错误前缀 —— */
    '读取失败：': 'Read failed: ',
    '数据加载失败：': 'Data load failed: ',
    '搜索失败：': 'Search failed: ',
    '导出失败：': 'Export failed: ',
    '删除失败：': 'Delete failed: ',
    '移除失败：': 'Remove failed: ',

    /* —— 导出 —— */
    '没有可导出的轨道': 'No tracks to export',
    '位置': 'Locus',
    '没有可用的中文字体：可在 web/font/cjk.ttf 放一份，或用环境变量 IGV_FONT 指定':
      'No CJK font available: drop one at web/font/cjk.ttf or point IGV_FONT at a font file',
    '先选择一个位置': 'Select a locus first',
    '未找到系统中文字体，已导出位图 PDF（IGV_FONT 可指定字体）':
      'No system CJK font found — exported a raster PDF (set IGV_FONT to pick one)',
    '包含左侧轨道名': 'Include track labels',
    '矢量（可编辑）': 'Vector (editable)',
    '矢量 · 内嵌字体': 'Vector · embedded font',
    'SVG / PDF 为矢量：线条与文字都能在 Illustrator 里逐个选中删除（PDF 已内嵌中文字体）。PNG 为 ':
      'SVG / PDF are vector: every line and label can be selected and deleted individually in Illustrator (the PDF embeds the CJK font). PNG is ',
    '× 位图。': '× raster.',
    '无': 'none',

    /* —— 轨道内容提示 —— */
    '此区域无基因注释': 'No gene annotation in this region',
    '该版本未内置基因注释': 'No gene annotation bundled for this assembly',
    '该版本未内置序列文件': 'No sequence file bundled for this assembly',
    '计算中…': 'Calculating…',
    '该版本未内置序列文件（可从 UCSC 下载 2bit 后放入 data/genomes）':
      'No sequence file bundled (download a 2bit from UCSC into data/genomes)',
    '未内置': 'not bundled',
    '继续放大以显示碱基序列': 'Zoom in further to show bases',
    '读取序列…': 'Loading sequence…',
    '5′←3′ (−) 链': '5′←3′ (−) strand',
    '5′→3′ (+) 链': '5′→3′ (+) strand',
    ' 条染色体': ' chromosomes',
    '点击展开全部': 'Click to expand',
    '此区域无注释': 'No annotation in this region',
    '0 个': '0',
    '放大到 ≤1.2 bp/px 显示碱基': 'Zoom to ≤1.2 bp/px to show bases',
    '需放大': 'zoom in',

    /* —— 遗传密码表 —— */
    '标准': 'Standard',
    '通用（默认）': 'Universal (default)',
    '脊椎动物线粒体': 'Vertebrate mitochondrial',
    '脊椎动物': 'Vertebrates',
    '酵母线粒体': 'Yeast mitochondrial',
    '酿酒酵母等': 'S. cerevisiae etc.',
    '霉菌·原生动物·腔肠动物线粒体；支原体；螺旋体':
      'Mold / protozoan / coelenterate mitochondrial; Mycoplasma; Spiroplasma',
    '多种': 'Various',
    '无脊椎动物线粒体': 'Invertebrate mitochondrial',
    '果蝇等': 'Drosophila etc.',
    '纤毛虫·绒枝藻·六鞭毛虫核': 'Ciliate / Dasycladacean / Hexamita nuclear',
    '四膜虫等': 'Tetrahymena etc.',
    '棘皮动物·扁形动物线粒体': 'Echinoderm / flatworm mitochondrial',
    '海胆、涡虫等': 'Sea urchin, planarian etc.',
    '游仆虫核': 'Euplotid nuclear',
    '细菌·古菌·植物质体': 'Bacterial / archaeal / plant plastid',
    '大肠杆菌、叶绿体等': 'E. coli, chloroplast etc.',
    '替代酵母核': 'Alternative yeast nuclear',
    '假丝酵母等': 'Candida etc.',
    '海鞘线粒体': 'Ascidian mitochondrial',
    '海鞘': 'Ascidians',
    '替代扁形动物线粒体': 'Alternative flatworm mitochondrial',
    '扁形动物': 'Flatworms',
    '赭纤虫大核': 'Blepharisma macronuclear',
    '绿藻线粒体': 'Chlorophycean mitochondrial',
    '绿藻': 'Green algae',
    '吸虫线粒体': 'Trematode mitochondrial',
    '血吸虫等': 'Schistosoma etc.',
    '斜生栅藻线粒体': 'Scenedesmus obliquus mitochondrial',
    '斜生栅藻': 'S. obliquus',
    '破囊壶菌线粒体': 'Thraustochytrium mitochondrial',
    '翼鳃类线粒体': 'Pterobranchia mitochondrial',
    '翼鳃类': 'Pterobranchia',
    '候选门 SR1 与 Gracilibacteria': 'Candidate division SR1 and Gracilibacteria',
    '细菌': 'Bacteria',
    '嗜鞣管囊酵母核': 'Pachysolen tannophilus nuclear',
    '核残迹虫核': 'Karyorelict nuclear',
    '齿口虫核': 'Condylostoma nuclear',
    '中缢虫核': 'Mesodinium nuclear',
    '缘毛虫核': 'Peritrich nuclear',
    '缘毛虫': 'Peritrichs',
    '芽生短膜虫核': 'Blastocrithidia nuclear',
    '蛇菰科质体': 'Balanophoraceae plastid',
    '蛇菰科': 'Balanophoraceae',
    '头盘虫科线粒体': 'Cephalodiscidae mitochondrial',
    '头盘虫科': 'Cephalodiscidae',

    /* —— 翻译轨道 —— */
    '显示氨基酸翻译': 'Show amino-acid translation',
    '氨基酸翻译': 'Amino-acid translation',
    '显示翻译': 'Show translation',
    '翻译表': 'Translation table',
    '点轨道上的 ⇄ 翻转后按互补链翻译。需放大到约 0.33 bp/px 以上才显示。':
      'Use ⇄ on the track to translate the complementary strand. Shown above ~0.33 bp/px.',

    /* —— motif —— */
    '视野超过 1 Mb，motif 轨道已隐藏（放大后自动出现）':
      'View is over 1 Mb — motif tracks hidden (they return when you zoom in)',
    '查找中…': 'Searching…',
    '该视野内没有位点': 'No sites in this view',
    '视野过大，已隐藏': 'View too large — hidden',
    '出错': 'error',
    '无序列': 'no sequence',
    ' 个位点': ' sites',
    '<button class="mx" title="移除这条 motif 轨道">×</button></div>':
      '<button class="mx" title="Remove this motif track">×</button></div>',
    '自动命名': 'Auto name',
    '请填写要查找的序列或正则': 'Enter a sequence or regular expression',
    '· IUPAC 简并碱基写法不能含特殊字符（例如 AARNNR）\n':
      '· IUPAC degenerate notation cannot contain special characters (e.g. AARNNR)\n',
    '· 正则写法除特殊字符外只能是 ACGTN（例如 TATAAA(A){3,}）':
      '· A regular expression may only use ACGTN outside special characters (e.g. TATAAA(A){3,})',
    '正链和负链的轨道名不能相同': 'Plus and minus track names must differ',
    '查找 motif': 'Find motif',
    '搜索模式': 'Search pattern',
    '正链轨道名': 'Plus-strand track name',
    '负链轨道名': 'Minus-strand track name',
    '取消': 'Cancel',
    '确定': 'OK',
    '关闭': 'Close',
    '隐藏': 'Hide',

    /* —— 信号轨道设置 —— */
    '分组 ': 'Group ',
    '自定义任意颜色': 'Custom colour',
    '路径': 'Path',
    '自定义': 'Custom',
    '自定义（空）': 'Custom (empty)',
    '重置': 'Reset',
    '完成': 'Done',
    '颜色': 'Colour',
    '数据范围': 'Data range',
    '自动': 'Auto',
    '固定': 'Fixed',
    '最小 / 最大': 'Min / max',
    '对数刻度（log10）：纵轴从窗口内最小正值起算，适合跨数量级的信号。':
      'Log scale (log10): the axis starts at the smallest positive value in the window — useful for signals spanning orders of magnitude.',
    '固定后纵轴不再随窗口变化；最小值可设负数（如 log2 比值）。':
      'Fixed pins the axis so it stops following the window; the minimum may be negative (e.g. log2 ratios).',
    '纵轴按当前窗口峰值自动缩放。': 'The axis autoscales to the peak in the current window.',
    '对数刻度（log10）': 'Log scale (log10)',
    '比对视图按链着色': 'Colour alignments by strand',
    '实验类型': 'Experiment type',
    '自动识别': 'Auto-detect',
    '普通': 'Standard',
    'RNA': 'RNA',
    '第三代测序': 'Third-generation sequencing',
    '最大窗口（kb）': 'Maximum window (kb)',
    '默认': 'Default',
    '移除当前轨道': 'Remove current track',
    '显示 Junctions': 'Show Junctions',
    '放大查看比对（Zoom in to see alignments）': 'Zoom in to see alignments',
    '仅隐藏当前子轨道，不删除 BAM 文件。': 'Hide this sub-track only; the BAM file is not deleted.',
    '恢复 Junctions 轨道': 'Restore Junctions track',
    '恢复 Alignments 轨道': 'Restore Alignments track',
    '剪接数据格式无效': 'Invalid junction data format',
    '无剪接记录': 'No junctions in this region',
    '读取失败': 'Read failed',
    '该区域没有比对记录': 'No alignments in this region',
    '无碱基序列': 'no base sequence',
    '（不分组）': '(no group)',
    '+ 新建分组…': '+ New group…',
    '组内共享纵轴（group autoscale）': 'Share the axis within the group (group autoscale)',
    '删除该轨道': 'Remove this track',
    '恢复被隐藏的内置信号轨道': 'Restore hidden built-in signal tracks',
    'Group Autoscale · 统一纵轴': 'Group autoscale · shared axis',
    '取消分组': 'Ungroup',
    '清除选择': 'Clear selection',
    '读取中…': 'Loading…',
    '该区域无信号': 'No signal in this region',
    '共享': 'shared',
    '该区域没有比对记录': 'No alignments in this region',
    '无碱基序列': 'no base sequence',
    '比对': 'Align',
    '轨道设置': 'Track settings',
    '轨道分组': 'Track group',
    '轨道': 'Tracks',
    '信号': 'Signal',
    '注释': 'Annotation',
    '序列': 'Sequence',

    /* —— 基因位置详情 —— */
    '基因位置详情': 'Gene feature details',
    '鼠标位置（1 基）': 'Mouse position (1-based)',
    '基因名称': 'Gene name',
    '基因 ID': 'Gene ID',
    '转录本 ID': 'Transcript ID',
    '链方向': 'Strand',
    '外显子': 'Exon',
    '内含子': 'Intron',
    'CDS 片段': 'CDS segment',
    '5′ UTR 片段': '5′ UTR segment',
    '3′ UTR 片段': '3′ UTR segment',
    '未提供': 'Not provided',
    '此位置无转录本': 'No transcript at this position',
    '编码状态': 'Coding status',
    '非编码转录本': 'Non-coding transcript',
    '此位置未命中基因结构': 'No gene feature at this position',
    '编号按转录方向；CDS/UTR 为当前模型推导片段，非原始注释 feature 编号。':
      'Numbered in transcript direction; CDS/UTR segments are inferred from the current model, not original annotation feature numbers.',

    /* —— 基因轨道设置 —— */
    '内含子总数': 'Total introns',
    '全部内含子：编号、区间与长度': 'All introns: number, interval and length',
    '当前位置': 'Current position',
    '位置区间（1 基，含两端）': 'Interval (1-based, inclusive)',
    '长度': 'Length',
    '基因轨道 · RefSeq': 'Gene track · RefSeq',
    '转录本': 'Transcripts',
    '显示方式': 'Display mode',
    '折叠一行': 'Collapsed',
    '分行排布': 'Packed',
    '所有基因画在同一行，重叠就重叠（同 IGV 的 collapsed，默认）':
      'Draw every gene on a single row, overlaps and all (IGV’s collapsed mode, the default)',
    '重叠的基因逐行往上叠，基因多时行数会变多':
      'Stack overlapping genes into extra rows — dense regions get taller',
    '每个转录本占一行；平移/缩放后新出现的基因也保持展开':
      'One row per transcript; genes that scroll into view stay expanded too',
    ' 当前：折叠为一行；点基因看右侧详情，或在详情里单独展开某个基因。':
      ' Currently: collapsed to one row — click a gene for details, or expand it from the detail panel.',
    ' 当前：分行排布（点基因右侧的 + 展开单个基因）。':
      ' Currently: packed (click + next to a gene to expand it).',
    '全部展开': 'Expand all',
    '一次展开这条轨道上所有基因的转录本（平移/缩放后新出现的基因也保持展开）':
      'Expand every transcript on this track — genes that scroll into view stay expanded too',
    '全部收起': 'Collapse all',
    '所有基因只画合并后的基因模型': 'Draw only the merged gene model',
    '正链颜色': 'Plus-strand colour',
    '负链颜色': 'Minus-strand colour',
    'CDS 颜色': 'CDS colour',
    'UTR 颜色': 'UTR colour',
    '仅作用于这条导入轨道；未设置的颜色沿用 RefSeq 轨道的设置。':
      'Applies to this imported track only; unset colours follow the RefSeq track.',
    '作用于 RefSeq 轨道；导入的 GTF 轨道默认跟随这里的设置。':
      'Applies to the RefSeq track; imported GTF tracks follow these settings by default.',
    ' 当前：全部展开（单独点某个基因的 − 可以只收起它）。':
      ' Currently: all expanded (click one gene’s − to collapse just that gene).',
    ' 当前：按需展开（点基因右侧的 + 展开单个基因）。':
      ' Currently: expand on demand (click + next to a gene).',
    '▾ 收起 ': '▾ Hide ',
    ' 个转录本': ' transcripts',
    '▸ 展开 ': '▸ Show ',
    '<p class="muted">点击基因查看转录本详情</p>':
      '<p class="muted">Click a gene to see its transcripts</p>',

    /* —— GC 轨道 —— */
    'GC 轨道': 'GC track',
    '曲线颜色': 'Line colour',
    '纵轴固定为 30%–70%，窗口过窄时按每格 ≥20 bp 合并。':
      'The axis is fixed at 30%–70%; very narrow windows are binned at ≥20 bp per step.',

    /* —— 导入 —— */
    '<option value="all">全部轨道</option>': '<option value="all">All tracks</option>',
    '准备上传…': 'Preparing upload…',
    '正在解析 / 建立索引…': 'Parsing / building index…',
    '导入完成': 'Import complete',
    '导入失败': 'Import failed',
    '网络错误': 'Network error',
    '已上传，正在解析 / 建立索引…（大文件可能需要 10–30 秒）':
      'Uploaded — parsing / building index… (large files can take 10–30 s)',
    '移除该轨道': 'Remove this track',
    '翻转链：显示互补链（同 IGV 序列轨道的 Flip strand）':
      'Flip strand: show the complementary strand (same as Flip strand in the IGV sequence track)',

    /* —— index.html 静态文案 —— */
    'Orbit · 基因组浏览器': 'Orbit · genome browser',
    '加载中…': 'Loading…',
    '全部轨道': 'All tracks',
    '内置': 'Built-in',
    '全部导入': 'All imported',
    '搜索范围：内置注释，或某个导入的 GTF / GFF 注释':
      'Scope: built-in annotation, or an imported GTF / GFF',
    '搜索范围：内置注释（导入 GTF / GFF 后可选导入注释）':
      'Scope: built-in annotation (import a GTF / GFF to search it)',
    '导入': 'Import',
    '分屏': 'Split',
    '导出': 'Export',
    '全染色体': 'Whole chromosome',
    '已导入': 'Imported',
    '热图颜色（增益 / 缺失）': 'Heatmap colours (gain / loss)',
    '增益颜色': 'Gain colour',
    '缺失颜色': 'Loss colour',
    '振幅 ±': 'Amplitude ±',
    '布局': 'Layout',
    '样本为行': 'Samples as rows',
    '样本为列': 'Samples as columns',
    '紧凑': 'Compact',
    '一行一个样本，样本名在左侧（默认）': 'One sample per row, names on the left (the default)',
    '一列一个样本（常规 CNV 矩阵的摆法），样本名在顶部':
      'One sample per column — the usual CNV matrix — names along the top',
    '不画样本名，轨道更矮；点轨道看详情': 'No sample names and a shorter track; click the track for details',
    '路径': 'Path',
    '自定义': 'Custom',
    '自定义（空）': 'Custom (empty)',
    '空': 'empty',
    '空 · 用自己导入的 FASTA / GTF': 'empty - bring your own FASTA / GTF',
    '无内置序列': 'no bundled sequence',
    '无内置注释': 'no bundled annotation',
    '从本地路径挂载': 'Mount from local path',
    '填文件的绝对路径（.bam / .bw / .seg / .gtf …）。不会复制文件；BAM 同目录下的 .bai 会自动用上。': 'Absolute path of a .bam / .bw / .seg / .gtf file. Nothing is copied, and a .bai next to the BAM is picked up automatically.',
    '请输入文件路径': 'Please enter a file path',
    '挂载': 'Mount',
    '挂载中…': 'Mounting…',
    '挂载失败：': 'Mount failed: ',
    '取消': 'Cancel',
    '样本名列': 'Sample names',
    'CNV Summary 行': 'CNV Summary row',
    '热图下方汇总所有选中样本': 'summarises the ticked samples under the heatmap',
    '显示 / 隐藏 CNV Summary 汇总行': 'Show / hide the CNV Summary row',
    '在热图左侧单独占一列': 'its own column left of the heatmap',
    '显示 / 隐藏样本名列': 'Show / hide the sample-name column',
    '显示样本': 'Samples shown',
    '全选': 'All',
    '全不选': 'None',
    '未选择样本 · 在轨道设置里勾选': 'No sample selected — tick some in the track settings',
    '零值颜色': 'Zero colour',
    '振幅留空时按整个文件的 |log2 比值| 97 分位自动定标，缩放时颜色不变。':
      'Leave the amplitude empty to auto-scale to the 97th percentile of |log2 ratio| over the whole file, so colours do not shift when you zoom.',
    '勾选显示 · 点名称选轨（Ctrl 多选）· 右键批量删除':
      'Tick to show · click a name to select (Ctrl for multi) · right-click to delete',
    '信号轨道': 'Signal tracks',
    '点名称选轨（Ctrl 多选）· 右键可统一纵轴 / 统一颜色':
      'Click a row to select (Ctrl for multi) · right-click to unify axis or colour',
    '悬停可高亮画布上的轨道 · Ctrl 多选 · × 删除 · 右键统一纵轴':
      'Hover to highlight the track on the canvas · Ctrl to multi-select · × to delete · right-click to unify the axis',
    '选择 / 详情': 'Selection / details',
    '点击基因查看转录本详情': 'Click a gene to see its transcripts',
    '染色体示意图': 'Ideogram',
    '标尺': 'Ruler',
    'RefSeq 基因': 'RefSeq genes',
    'GC 含量': 'GC content',
    '全基因组总览': 'Whole-genome overview',
    '全部染色体': 'All chromosomes',
    '全部': 'All',
    '选择染色体：看整条染色体，或全部染色体（全基因组视野）':
      'Chromosome: one whole chromosome, or all chromosomes (whole-genome view)',
    '点击任意染色体进入该条染色体的完整视野':
      'Click any chromosome to open it in full',
    '染色体': 'Chromosome',
    '全基因组': 'Whole genome',
    '导入中…': 'Importing…',
    '支持：基因名（TP53）、位置（chr7:55,000,000-55,200,000）、多个用逗号分隔（TP53, BRCA1）':
      'Accepts a gene symbol (TP53), a locus (chr7:55,000,000-55,200,000), or several separated by commas (TP53, BRCA1)',
    '从导入的 GTF / GFF 注释里搜索基因': 'Search genes in the imported GTF / GFF annotation',
    '在导入的注释中搜索基因': 'Search genes in imported annotation',
    '从导入的 GTF / GFF 注释里搜索基因并跳转':
      'Search the imported GTF / GFF annotation and jump to a gene',
    '选择搜索范围（全部轨道或指定轨道）': 'Scope of the search (all tracks or one track)',
    '导入文件：bigWig / bedGraph / WIG / SEG / BAM / SAM / GTF / FASTA（也可直接把文件拖进窗口）':
      'Import files: bigWig / bedGraph / WIG / SEG / BAM / SAM / GTF / FASTA (or drag them into the window)',
    '多位置分屏：同时看多个基因（每屏可独立导航）':
      'Split view: several loci at once (each panel navigates independently)',
    '导出当前视图：PNG（位图）/ SVG、PDF（矢量，可在 Illustrator 里编辑）':
      'Export the current view: PNG (raster) / SVG or PDF (vector, editable in Illustrator)',
    '查找 motif：在视野内搜核苷酸序列 / IUPAC 简并碱基 / 正则，正负链各一条轨道（同 IGV 的 Tools → Find Motif）':
      'Find motif: search nucleotide / IUPAC degenerate / regex patterns in view, one track per strand (same as Tools → Find Motif in IGV)',
    '整条染色体 (Home)': 'Whole chromosome (Home)',
    '缩小 (-)': 'Zoom out (-)',
    '放大 (+)': 'Zoom in (+)',
    '切换主题': 'Switch theme',
    '切换浅色 / 深色主题': 'Switch between light and dark theme',
    '显示氨基酸翻译（可切换遗传密码表）': 'Show amino-acid translation (genetic code is selectable)',
    '展开 / 收起全基因组总览': 'Expand / collapse the whole-genome overview',
    '本次数据请求耗时': 'Time spent on the last data request',
    '可填核苷酸序列（ACCGCT）、带 IUPAC 简并碱基的序列（AARNNR），或正则表达式（TATAAA(A){3,}）。':
      'Accepts a nucleotide sequence (ACCGCT), one with IUPAC degenerate bases (AARNNR), or a regular expression (TATAAA(A){3,}). ',
    '一行一个': 'One per line',
    '，每行生成一对正链 / 负链轨道。只在当前视野里查找；视野超过 1 Mb 时轨道自动隐藏（同 IGV）。':
      ' — each line becomes a plus / minus track pair. Only the current view is searched; tracks hide automatically above 1 Mb (as in IGV).',
    '语言': 'Language',
    '切换界面语言（中文 / English）': 'Switch interface language (Chinese / English)'
  };

  /* ------------------------------------------------------------ 模式规则 */
  /* 模板字面量拼接后才知道长什么样，所以按「结果字符串」匹配。 */
  var RULES = [
    [/^载入 ([\d.]+) ms$/, 'Loaded in $1 ms'],
    [/^已挂载 (.+)$/, 'Mounted $1'],
    [/^没找到：(.+)$/, 'Not found: $1'],
    [/^当前 (\d+) 屏 · 每屏可独立导航$/, '$1 panels · each navigates independently'],
    [/^(\d+) 屏$/, '$1 panels'],
    [/^<span>1 屏<\/span>(<span class="muted">[\s\S]*<\/span>)$/, '<span>1 panel</span>$1'],
    [/^<span>(\d+) 屏<\/span>(<span class="muted">[\s\S]*<\/span>)$/, '<span>$1 panels</span>$2'],
    [/^正在导出 (.+)…$/, 'Exporting $1…'],
    [/^已导出 PNG（(\d+)×(\d+)）$/, 'Exported PNG ($1×$2)'],
    [/^已导出矢量 SVG（(\d+)×(\d+)，([\d,]+) 个图元）$/, 'Exported vector SVG ($1×$2, $3 shapes)'],
    [/^已导出矢量 PDF（(\d+)×(\d+)，([\d,]+) KB）$/, 'Exported vector PDF ($1×$2, $3 KB)'],
    [/^位图 ([\d.]+)×$/, 'Raster $1×'],
    // 轨道左侧的基因计数（RefSeq / 导入 GTF 的 .sub）。必须排在通用的「N 个」之前，
    // 否则英文只剩一个光秃秃的数字，看不出量的是什么。
    [/^(≥ )?([\d,]+)(\+?) 个基因$/, '$1$2$3 genes'],
    [/^([\d,]+)(\+?) 个$/, '$1$2'],
    [/^(≥ )?([\d,]+) 个$/, '$1$2'],
    [/^仅显示前 ([\d,]+) 个基因，请放大查看$/, 'Showing the first $1 genes — zoom in to see the rest'],
    [/^氨基酸翻译：开（(.+)）$/, 'Translation: on ($1)'],
    [/^(.+) — (.+)。三行分别是 3 个读码框（密码子按基因组坐标每 3 bp 划分）；$/,
      '$1 — $2. The three rows are the three reading frames (codons split every 3 bp by genomic coordinate);'],
    [/^(.+)–(.+) Mb · 共 (.+) Mb$/, '$1–$2 Mb of $3 Mb'],
    [/^「(.+)」不是合法的查找模式：\n$/, '"$1" is not a valid search pattern:\n'],
    [/^信号轨道 · (.+)$/, 'Signal track · $1'],
    [/^当前窗口峰值 (.+)，纵轴自动取整。$/, 'Peak in this window: $1 — the axis is rounded automatically.'],
    [/^本组 (\d+) 条轨道；开启后取组内最大范围统一缩放。$/,
      '$1 tracks in this group; when on, they share the widest range.'],
    [/^基因轨道 · (.+)$/, 'Gene track · $1'],
    [/^(.+)\n点名称选择（Ctrl 多选）；右键可统一纵轴 \/ 批量删除$/,
      '$1\nClick a name to select (Ctrl for multi-select); right-click to unify the axis or delete in bulk'],
    [/^(.+)\n该轨道不属于当前装配（染色体长度不匹配）$/,
      '$1\nThis track does not belong to the current assembly (chromosome lengths differ)'],
    [/^(.+) 比对视图\n勾选显示 reads 堆叠（灰块）；右键该 BAM 可批量删除$/,
      '$1 alignment view\nTick to show stacked reads (grey blocks); right-click this BAM to delete in bulk'],
    [/^已隐藏 (\d+) 条 · 点此恢复$/, '$1 hidden · click to restore'],
    [/^已选 (\d+) 条信号轨道$/, '$1 signal tracks selected'],
    [/^统一颜色 · (\d+) 条轨道$/, 'Unify colour · $1 tracks'],
    [/^删除选中的 (\d+) 条轨道$/, 'Delete $1 selected tracks'],
    [/^已为 (\d+) 条轨道启用 Group Autoscale（(.+)）$/, 'Group autoscale enabled for $1 tracks ($2)'],
    [/^· (\d+) 条内置轨道：仅从列表隐藏，可随时恢复$/,
      '· $1 built-in tracks: hidden from the list only, restorable at any time'],
    [/^· (\d+) 条已导入轨道：会删除 data\/loaded 下的副本文件$/,
      '· $1 imported tracks: the copies under data/loaded are deleted'],
    [/^确定删除选中的 (\d+) 条信号轨道？\n([\s\S]*)$/, 'Delete the $1 selected signal tracks?\n$2'],
    [/^已删除 (\d+) 条信号轨道$/, 'Deleted $1 signal tracks'],
    [/^([\d,]+) \/ ([\d,]+) 条 read$/, '$1 / $2 reads'],
    [/^([\d,/]+) 条 read$/, '$1 reads'],
    [/^仅返回\s*([\d,]+)\s*\/\s*([\d,]+)\s*条\s*（达到上限）$/, 'Returned only $1 / $2 reads (limit reached)'],
    [/^仅返回\s*([\d,]+)\s*\/\s*([\d,]+)\s*条（达到上限）$/, 'Returned only $1 / $2 reads (limit reached)'],
    [/^第 (\d+) 个 \/ 共 (\d+) 个$/, '$1 of $2'],
    [/^行 (\d+)–(\d+) \/ (\d+) · 滚轮上下浏览$/, 'Rows $1–$2 / $3 · scroll up/down to browse'],
    [/^(\d+) 个剪接位点$/, '$1 junctions'],
    [/^当前生效 (.+) kb；覆盖度、比对和剪接共用。留空按实验类型：普通 30、RNA 300、第三代 1000 kb；自动识别未知时按普通。$/,
      'Active: $1 kb; shared by coverage, alignments, and junctions. Leave blank to use experiment defaults: Standard 30, RNA 300, third-generation 1000 kb; unknown auto-detection uses Standard.'],
    [/^该 BAM 在 (.+) 没有剪接记录$/, 'This BAM has no junctions on $1'],
    [/^(.+) 在 (.+) 没有剪接记录$/, '$1 has no junctions on $2'],
    [/^没有剪接记录$/, 'No junctions'],
    [/^没有剪接位点$/, 'No junctions'],
    [/^放大查看剪接（Zoom in to see junctions）$/, 'Zoom in to see junctions'],
    [/^放大查看比对记录（Zoom in to see alignments）$/, 'Zoom in to see alignments'],
    [/^放大查看覆盖度（Zoom in to see coverage）$/, 'Zoom in to see coverage'],
    [/^该 BAM 在 (.+) 没有比对记录$/, 'This BAM has no alignments on $1'],
    [/^ {2}\[屏 (\d+)\/(\d+)\]$/, '  [panel $1/$2]'],
    [/^未在导入注释中找到「(.+)」$/, '"$1" not found in the imported annotation'],
    [/^未在导入注释中找到：(.+)$/, 'Not found in the imported annotation: $1'],
    [/^未找到：(.+)$/, 'Not found: $1'],
    [/^未找到「(.+)」$/, '"$1" not found'],
    [/^(\d+) 屏（未找到：(.+)）$/, '$1 panels (not found: $2)'],
    [/^(.+) → (\d+) 屏$/, '$1 → $2 panels'],
    [/^ {2}\(峰值 (.+)\) {2}\[(.+)–(.+)\]$/, '  (peak $1)  [$2–$3]'],
    [/^上传中 (\d+)% · (.+)$/, 'Uploading $1% · $2'],
    [/^ · ([\d,]+) 个基因$/, ' · $1 genes'],
    [/^ · ([\d,]+) 个区间$/, ' · $1 intervals'],
    [/^ · ([\d,]+) 个样本$/, ' · $1 samples'],
    [/^(\d+) 个样本 · ±(.+)$/, '$1 samples · ±$2'],
    [/^(\d+)\/(\d+) 个样本 · ±(.+)$/, '$1/$2 samples · ±$3'],
    [/^热图 · (\d+)\/(\d+) 样本$/, 'Heatmap · $1/$2 samples'],
    [/^拷贝数热图 · (.+)$/, 'Copy-number heatmap · $1'],
    [/^(\d+) 个样本，一行一个；振幅留空时按窗口内 \|log2 比值\| 的 95 分位自动定标。$/,
      '$1 samples, one per row; leave the amplitude empty to auto-scale to the 95th percentile of |log2 ratio|.'],
    [/^已导入 (\d+) 个文件$/, 'Imported $1 files'],
    [/^已导入 (.+)$/, 'Imported $1'],
    [/^(.+) 之前已导入，已定位到原轨道$/, '$1 was already imported — jumped to the existing track'],
    [/^热图 · (\d+) 样本$/, 'Heatmap · $1 samples'],
    [/^(\d+) 条$/, '$1'],
    [/^(\d+) 条染色体$/, '$1 chromosomes'],
    [/^(.+) · ([\d.]+) Gb · (\d+) 条染色体 · 点染色体看整条$/,
      '$1 · $2 Gb · $3 chromosomes · click one to open it'],
    [/^不支持的文件类型：(\S+)（\.txt \/ \.tsv 需要是带表头的 SEG 表）$/,
      'Unsupported file type: $1 (.txt / .tsv must be a SEG table with a header row)'],
    [/^不支持的文件类型：(\S+)$/, 'Unsupported file type: $1'],
    [/^导入 (\d+) 个，失败：(.+)$/, 'Imported $1, failed: $2'],
    [/^(.+)\n(.+) · (.+) · (\d+) 条染色体$/, '$1\n$2 · $3 · $4 chromosomes'],
    [/^已移除 (.+)$/, 'Removed $1'],
    [/^已选 (\d+) 条导入轨道$/, '$1 imported tracks selected'],
    [/^确定删除选中的 (\d+) 条导入轨道？\n· ([\s\S]*)\n\n对应文件会从 data\/loaded 中删除。$/,
      'Delete the $1 selected imported tracks?\n· $2\n\nThe files are removed from data/loaded.'],
    [/^已删除 (\d+) 条导入轨道$/, 'Deleted $1 imported tracks'],
    [/^([\d,]+) 个 · 密度$/, '$1 · density'],
    [/^互补链 · (\d+) bp$/, 'Complement · $1 bp'],
    /* 后端 server.py 直接返回的中文提示（见 reason 字段） */
    [/^该文件不含 (.+)$/, 'This file has no $1'],
    [/^该 BAM 在 (.+) 没有比对记录$/, 'This BAM has no alignments on $1'],
    [/^无可用序列（本地无 2bit，远程不可达或已禁用）$/,
      'No sequence available (no local 2bit; remote unreachable or disabled)'],
    [/^视野为空$/, 'Empty view'],
    [/^当前装配没有内置序列，无法查找 motif$/,
      'No bundled sequence for this assembly — motif search unavailable']
  ];

  /* ------------------------------------------------------- 局部替换（SUB） */
  /* 这些是嵌在整段 HTML 模板里、又不是独立字面量的中文。必须「全部累加执行」，
   * 只取第一条会把同一段模板里剩下的中文留在页面上。 */
  var SUBS = [
    [/title="轨道设置"/g, 'title="Track settings"'],
    [/title="(.+) 比对"/g, 'title="$1 alignments"'],
    [/<span class="k">位置<\/span>/g, '<span class="k">Locus</span>'],
    [/<span class="k">基因<\/span>/g, '<span class="k">Gene</span>'],
    [/<b>位置<\/b>/g, '<b>Locus</b>'],
    [/<b>链<\/b>/g, '<b>Strand</b>'],
    [/<b>长度<\/b>/g, '<b>Length</b>'],
    [/<b>转录本<\/b>/g, '<b>Transcripts</b>'],
    [/<th>转录本<\/th>/g, '<th>Transcript</th>'],
    [/<th>外显子<\/th>/g, '<th>Exons</th>'],
    [/<span>(\d+) 个<\/span>/g, '<span>$1</span>'],
    [/<p class="muted">…共 ([\d,]+) 个转录本<\/p>/g, '<p class="muted">…$1 transcripts in total</p>']
  ];

  var CJK = /[\u4e00-\u9fff]/;

  /** 把中文原文翻成当前语言；没有对应条目时原样返回。 */
  function t(s) {
    if (lang !== 'en' || typeof s !== 'string' || !CJK.test(s)) return s;
    var hit = EN[s];
    if (hit !== undefined) return hit;

    // 1) 局部替换：全部累加（一段模板里可能有好几处中文）
    var out = s;
    for (var i = 0; i < SUBS.length; i++) {
      var sub = SUBS[i][0];
      sub.lastIndex = 0;                       // 带 g 的正则 test() 会推进 lastIndex
      if (sub.test(out)) out = out.replace(sub, SUBS[i][1]);
    }
    if (!CJK.test(out)) return out;

    // 2) 整串规则：模板拼接后才知道长什么样，取第一条命中的
    for (var j = 0; j < RULES.length; j++) {
      var re = RULES[j][0];
      re.lastIndex = 0;
      if (re.test(out)) return out.replace(re, RULES[j][1]);
    }
    return out;
  }

  var ATTRS = ['title', 'placeholder', 'aria-label'];

  /** 翻译一段静态 DOM：文本节点按整串匹配，属性按值匹配。 */
  function applyDom(root) {
    if (lang !== 'en' || !root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var raw = node.nodeValue;
      if (!CJK.test(raw)) continue;
      var trimmed = raw.trim();
      var hit = EN[trimmed];
      if (hit === undefined) continue;
      // 保留原有的缩进 / 换行，只替换内容
      var lead = raw.match(/^\s*/)[0];
      var tail = raw.match(/\s*$/)[0];
      node.nodeValue = lead + hit + tail;
    }
    var els = root.querySelectorAll ? root.querySelectorAll('[title],[placeholder],[aria-label]') : [];
    for (var k = 0; k < els.length; k++) {
      for (var a = 0; a < ATTRS.length; a++) {
        var v = els[k].getAttribute(ATTRS[a]);
        if (!v || !CJK.test(v)) continue;
        var h = EN[v];
        if (h !== undefined) els[k].setAttribute(ATTRS[a], h);
      }
    }
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'zh';
    try { localStorage.setItem(STORE_KEY, lang); } catch (e) { /* ignore */ }
    location.reload();
  }

  /** 工具栏里的语言切换按钮（index.html 里已放好 #btnLang，这里只负责填内容）。 */
  function initSwitch() {
    var btn = document.getElementById('btnLang');
    if (!btn) return;
    btn.title = lang === 'en' ? 'Switch interface language (Chinese / English)'
      : '切换界面语言（中文 / English）';
    btn.setAttribute('aria-label', btn.title);
    btn.textContent = lang === 'en' ? 'EN' : '中';
    btn.onclick = function () { setLang(lang === 'en' ? 'zh' : 'en'); };
  }

  // 静态文案先翻，再把 <html lang> 改成对应语言
  function boot() {
    initSwitch();
    if (lang === 'en') {
      document.documentElement.lang = 'en';
      var ttl = EN[document.title.trim()];
      if (ttl !== undefined) document.title = ttl;
      applyDom(document.body);
    }
  }

  global.I18N = {
    t: t, applyDom: applyDom, setLang: setLang,
    get lang() { return lang; }
  };
  global.t = t;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
