import pathlib
import polib

BASE = pathlib.Path("docs/locale/zh_CN/LC_MESSAGES")


def apply(name, mapping):
    po = polib.pofile(str(BASE / name))
    miss = []
    for e in po:
        if e.obsolete:
            continue
        if e.msgid in mapping:
            v = mapping[e.msgid]
            if v:
                e.msgstr = v
            e.flags = [f for f in e.flags if f != "fuzzy"]
        elif not e.msgstr:
            miss.append(e.msgid)
    po.metadata["PO-Revision-Date"] = "2026-10-29 15:00+0800"
    po.metadata["Last-Translator"] = "junjunlab"
    po.save()
    print(f"{name}: translated {len(mapping)}, missing {len(miss)}")
    for m in miss:
        print("   MISS:", m[:90])


IMPORT = {
    "Importing data": "导入数据",
    "Orbit reads the common genomics formats directly. Drag a file onto the window, or press the **Import** button in the toolbar. The format is chosen by extension.":
        "Orbit 直接读取常见的基因组格式。把文件拖进窗口，或点工具栏的 **导入**。"
        "格式按扩展名判断。",
    "Supported formats": "支持的格式",
    "Format": "格式",
    "Extension": "扩展名",
    "Notes": "说明",
    "bigWig": "bigWig",
    "``.bw`` ``.bigWig``": "``.bw`` ``.bigWig``",
    "Random access, no indexing step. Best choice for signal.":
        "随机访问，无需建索引。信号轨道的首选。",
    "bedGraph": "bedGraph",
    "``.bedGraph`` ``.bdg``": "``.bedGraph`` ``.bdg``",
    "Loaded into memory; fine up to a few hundred MB.":
        "整份读进内存；几百 MB 以内没问题。",
    "BAM": "BAM",
    "``.bam``": "``.bam``",
    "Needs a ``.bai`` next to it. Coverage is computed on the fly.":
        "旁边必须有 ``.bai``。覆盖度是实时计算的。",
    "GTF / GFF3": "GTF / GFF3",
    "``.gtf`` ``.gff`` ``.gff3``": "``.gtf`` ``.gff`` ``.gff3``",
    "Becomes a gene track; UTR and CDS features are kept.":
        "变成一个基因轨道；UTR 和 CDS 特征都会保留。",
    "FASTA": "FASTA",
    "``.fa`` ``.fasta``": "``.fa`` ``.fasta``",
    "Registers the file as a local sequence source for the current assembly.":
        "把该文件注册为当前装配的本地序列来源。",
    "The recommended format. Orbit parses the index itself, so there is no ``bigWigToBedGraph`` step and no conversion. Multi-sample overlays work best when the files share a coordinate system.":
        "推荐格式。Orbit 自己解析索引，不需要 ``bigWigToBedGraph`` 转换。"
        "多样本叠加时，文件之间共用坐标系效果最好。",
    "The track appears immediately with autoscale on. Open its label to pin the range if you want several samples to share one scale.":
        "轨道会立刻出现，默认自动缩放。想让多个样本共用同一量程，"
        "就打开轨道标签把范围固定下来。",
    "Plain text, four columns. Convenient for small, hand-made tracks; a genome-wide file will cost memory, so prefer bigWig above a few hundred megabytes.":
        "纯文本，四列。适合小型手工轨道；全基因组级别会吃内存，"
        "超过几百 MB 建议改用 bigWig。",
    "Orbit needs both ``sample.bam`` and ``sample.bam.bai`` in the same directory. Coverage is computed from the reads in the visible window only, which keeps memory flat but means the first draw of a new region takes a moment.":
        "Orbit 需要 ``sample.bam`` 和 ``sample.bam.bai`` 放在同一目录。"
        "覆盖度只按可见窗口内的 reads 计算，内存占用平稳，"
        "代价是第一次画新区域要等一下。",
    "Imported annotations become a normal gene track: expandable transcripts, strand colours, labels. Transcript and CDS features are preserved, so a GTF exported from StringTie or Ensembl looks the way you expect.":
        "导入的注释会成为普通基因轨道：可展开转录本、按链着色、带标签。"
        "转录本与 CDS 特征都会保留，所以 StringTie 或 Ensembl 导出的 GTF "
        "看起来就是你预期的样子。",
    "Imported annotations are not converted to the built-in binary format. They are read on load, which is fine for a few hundred thousand features but slower than the bundled RefSeq index.":
        "导入的注释不会转成内置二进制格式，而是加载时现读。"
        "几十万条特征没问题，但比内置的 RefSeq 索引慢。",
    "Loading a FASTA registers it as the local sequence source for the assembly. This is how you use Orbit fully offline, or work with an assembly that UCSC does not host.":
        "载入 FASTA 会把它注册为该装配的本地序列来源。"
        "这是完全离线使用 Orbit 的办法，也适用于 UCSC 上没有的装配。",
    "Large FASTA files are memory-mapped, so a 3 GB genome does not need 3 GB of RAM — but the first access to a chromosome still costs a disk read.":
        "大 FASTA 采用内存映射，3 GB 的基因组不需要 3 GB 内存"
        "——但首次访问某条染色体仍要读一次磁盘。",
    "Where imported tracks live": "导入的轨道存在哪",
    "Imported files are referenced in place, not copied. If you move or delete the original, the track breaks on the next launch. Paths are stored in the session, so reopening Orbit restores the tracks you had.":
        "导入的文件是原地引用，不会复制。移动或删除原文件后，"
        "下次启动轨道就会失效。路径记录在会话里，"
        "重新打开 Orbit 会恢复之前的轨道。",
}

QUICK = {
    "Quick start": "快速上手",
    "Five minutes from launch to a figure.": "五分钟，从打开到出图。",
    "1. Open a locus": "1. 打开一个位点",
    "Type a locus into the search box at the top and press :kbd:`Enter`. All of these work:":
        "在顶部搜索框输入位点，按 :kbd:`Enter`。下面这些写法都支持：",
    "A gene symbol jumps to its full extent; coordinates are 1-based and inclusive, matching the IGV convention.":
        "基因名会跳到它的完整范围；坐标是 1-based 闭区间，与 IGV 约定一致。",
    "2. Choose an assembly": "2. 选择装配",
    "The assembly selector sits next to the search box. Orbit ships with 18 assemblies — see :doc:`assemblies`. Changing the assembly keeps the locus text if the chromosome name also exists in the new genome.":
        "装配选择器在搜索框旁边。Orbit 内置 18 个装配，见 :doc:`assemblies`。"
        "切换装配时，如果新基因组里也有同名染色体，位点文本会保留。",
    "3. Look at the tracks": "3. 看轨道",
    "The left column lists tracks. Click a name to open its settings, or use the checkbox to hide it. From top to bottom you normally see:":
        "左栏列出所有轨道。点名称打开设置，用复选框隐藏。从上到下通常是：",
    "**Ideogram** — cytobands with the current view marked":
        "**染色体示意图** —— 细胞遗传带，标出当前视野",
    "**Ruler** — genomic coordinates and scale":
        "**标尺** —— 基因组坐标与比例",
    "**RefSeq genes** — gene models, expandable to transcripts":
        "**RefSeq 基因** —— 基因模型，可展开到转录本",
    "**Signal tracks** — any bigWig you have loaded":
        "**信号轨道** —— 你载入的任意 bigWig",
    "**GC content** — computed from the sequence on demand":
        "**GC 含量** —— 按需从序列计算",
    "**Sequence** — bases, once you are zoomed in far enough":
        "**序列** —— 放大到足够近时显示碱基",
    "4. Load your own data": "4. 载入自己的数据",
    "Drag a file onto the window, or press **Import** in the toolbar. bigWig, bedGraph, BAM, GTF/GFF and FASTA are recognised by extension. Details in :doc:`data-import`.":
        "把文件拖进窗口，或点工具栏的 **导入**。bigWig、bedGraph、BAM、"
        "GTF/GFF 和 FASTA 按扩展名识别。详见 :doc:`data-import`。",
    "5. Export the view": "5. 导出视图",
    "Press the export button in the toolbar and choose PNG, SVG or PDF. Vector formats stay editable in Illustrator and Inkscape. Details in :doc:`data-export`.":
        "点工具栏的导出按钮，选 PNG、SVG 或 PDF。"
        "矢量格式在 Illustrator 和 Inkscape 里仍可编辑。详见 :doc:`data-export`。",
    "Keyboard essentials": "常用快捷键",
    "Key": "按键",
    "Action": "动作",
    ":kbd:`←` / :kbd:`→`": "",
    "Pan by half a screen": "平移半屏",
    ":kbd:`Shift` + :kbd:`←` / :kbd:`→`": "",
    "Pan by a tenth of a screen": "平移十分之一屏",
    ":kbd:`+` / :kbd:`-`": "",
    "Zoom in / out": "放大 / 缩小",
    ":kbd:`Ctrl` + :kbd:`F`": "",
    "Focus the search box": "定位到搜索框",
    ":kbd:`Ctrl` + :kbd:`S`": "",
    "Export the current view": "导出当前视图",
    ":kbd:`Esc`": "",
    "Close the current dialog or clear the selection": "关闭当前对话框或清除选区",
    "Dragging horizontally on the ruler pans the view; dragging on a gene track selects a region and shows its size.":
        "在标尺上横向拖动可平移视图；在基因轨道上拖动会选中一个区域并显示其长度。",
}

HOW = {
    "How it works": "实现原理",
    "Orbit is small because it does very little at runtime. Three formats are read directly, and everything else is prepared once, at build time.":
        "Orbit 之所以小，是因为运行时几乎什么都不做。三种格式直接读取，"
        "其余都在构建期准备好。",
    "Sequence: 2bit": "序列：2bit",
    "The 2bit format packs four bases into a byte plus an index of block offsets, so a random 20 kb window can be decoded without touching the rest of the file. Orbit's reader (:mod:`igvlocal.twobit`) implements the format with the standard library only — no py2bit, no C extension.":
        "2bit 格式把四个碱基压进一个字节，另带一份数据块偏移索引，"
        "所以解码任意 20 kb 窗口都不必碰文件其余部分。"
        "Orbit 的读取器 :mod:`igvlocal.twobit` 只用标准库实现"
        "——不需要 py2bit，也不需要 C 扩展。",
    "When the file is remote, the same reader works through HTTP Range requests: it fetches the index once, then only the blocks the window overlaps. This is why the installer does not ship a genome.":
        "文件在远端时，同一个读取器通过 HTTP Range 工作：索引取一次，"
        "之后只取窗口覆盖的块。安装包因此不需要附带基因组。",
    "Annotation: igvbin": "注释：igvbin",
    "RefSeq ``refGene`` is a flat table of exon starts and ends encoded as comma-separated strings. Parsing it at startup costs seconds and hundreds of megabytes. So it is compiled once into ``genes.igvbin``:":
        "RefSeq 的 ``refGene`` 是一张平表，外显子起止被编码成逗号分隔的字符串。"
        "启动时解析它要几秒和几百 MB 内存。所以它被一次性编译成 "
        "``genes.igvbin``：",
    "a header with chromosome count and offsets": "一个头部，记录染色体数量和偏移",
    "a per-chromosome block of gene records, sorted by start":
        "按染色体分块的基因记录，按起点排序",
    "an interned string pool for symbols and accessions":
        "符号与编号共用的字符串池",
    "a transcript table, so expansion does not re-read the gene":
        "一张转录本表，展开时不必重读基因",
    "Loading a chromosome becomes a single ``mmap`` slice plus a binary search, which is why a whole chromosome of genes appears in milliseconds. The reader (:mod:`igvlocal.annbin`) is about 300 lines and has no dependencies.":
        "加载一条染色体变成一次 ``mmap`` 切片加一次二分查找，"
        "所以整条染色体的基因能在毫秒级出现。"
        "读取器 :mod:`igvlocal.annbin` 约 300 行，无任何依赖。",
    "Signal: bigWig": "信号：bigWig",
    "bigWig is a binary, indexed format: a B-tree of data blocks and an R-tree of genomic ranges. Orbit parses both (:mod:`igvlocal.bigwig`) and reads only the blocks covering the window.":
        "bigWig 是带索引的二进制格式：数据块的 B 树加基因组区间的 R 树。"
        "Orbit 两者都解析 :mod:`igvlocal.bigwig`，只读窗口覆盖的块。",
    "That means a 40 GB bigWig behaves like a small file — the cost of opening it is a few hundred bytes of index, not the whole track. bedGraph files are the exception: they have no index, so they are read into memory.":
        "这意味着 40 GB 的 bigWig 表现得像个小文件——打开它的代价是几百字节索引，"
        "而不是整条轨道。bedGraph 是例外：它没有索引，只能整份读进内存。",
    "The server": "服务端",
    "The backend is a single-threaded HTTP server from the standard library. It serves three things:":
        "后端是标准库里单线程的 HTTP 服务，只提供三样东西：",
    "Endpoint": "端点",
    "Purpose": "用途",
    "``/`` and static files": "``/`` 与静态文件",
    "The frontend, served from ``web/``": "前端，从 ``web/`` 提供",
    "``/api/...``": "``/api/...``",
    "JSON: catalog, genes in a window, sequence, bigWig values, search":
        "JSON：装配清单、窗口内基因、序列、bigWig 数值、搜索",
    "``/export/...``": "``/export/...``",
    "Rendered exports": "渲染好的导出文件",
    "The window itself is QtWebEngine, so the frontend is ordinary browser code — Canvas for tracks, plain DOM for controls, no framework. The same page runs in Chrome if you pass ``--browser``, which is how most of the UI is tested.":
        "窗口本身是 QtWebEngine，所以前端就是普通浏览器代码"
        "——轨道用 Canvas，控件用原生 DOM，没有框架。"
        "加 ``--browser`` 时同一个页面也能在 Chrome 里跑，"
        "UI 的大部分测试就是这么做的。",
    "Why this shape": "为什么这样设计",
    "Decision": "决策",
    "Reason": "理由",
    "No framework": "不用框架",
    "The whole frontend is one file and loads instantly; there is no build step":
        "整个前端就是一个文件，加载即用，没有构建步骤",
    "Standard library only": "只用标准库",
    "No wheels to compile, no version conflicts, and the frozen build is small":
        "没有要编译的 wheel，没有版本冲突，冻结产物也小",
    "Compile annotations ahead of time": "注释提前编译",
    "Startup cost moves to the build machine, where it is paid once":
        "启动开销转移到构建机上，只需付一次",
    "Stream sequence": "序列走流式",
    "A 3 GB genome is not something you want in an installer":
        "3 GB 的基因组不该塞进安装包",
    "Qt over a web view": "用 Qt 而不是纯网页",
    "Same rendering engine as Chrome, but a real window and real file dialogs":
        "与 Chrome 同一个渲染引擎，但有真正的窗口和原生文件对话框",
}

apply("data-import.po", IMPORT)
apply("quickstart.po", QUICK)
apply("how-it-works.po", HOW)
