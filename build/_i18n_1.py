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
    po.metadata["Language"] = "zh_CN"
    po.save()
    print(f"{name}: translated {len(mapping)}, missing {len(miss)}")
    for m in miss:
        print("   MISS:", m[:90])


INDEX = {
    "Getting started": "快速开始",
    "Using Orbit": "使用 Orbit",
    "Under the hood": "实现原理",
    "Orbit": "Orbit",
    "Orbit is a desktop genome browser for people who need to look at a locus *now*. It opens as a native window, needs no Java, no server and no setup, and works offline once a chromosome has been visited.":
        "Orbit 是一个桌面基因组浏览器，面向那些需要*立刻*看清某个位点的人。"
        "它以原生窗口打开，不需要 Java、不用起服务、不用配置，"
        "某条染色体访问过一次之后即可离线工作。",
    "RefSeq annotations are compiled into a binary index at build time, and sequence is read from UCSC 2bit files — from disk or over HTTP Range — so a whole chromosome of genes loads in milliseconds and the installer stays around 70 MB of annotation instead of carrying a 3 GB genome.":
        "RefSeq 注释在构建期就被编译成二进制索引，序列则直接从 UCSC 的 2bit 文件读取"
        "——本地磁盘或 HTTP Range 均可——所以一整条染色体的基因能在毫秒级加载，"
        "安装包只背约 70 MB 注释，而不是 3 GB 基因组。",
    "The Orbit window showing three loci side by side with signal tracks":
        "Orbit 窗口：并排显示三个位点及信号轨道",
    "What you get": "功能一览",
    "A native Qt window (no browser tab, no local server to babysit)":
        "原生 Qt 窗口（不占浏览器标签页，无需照看本地服务）",
    "18 assemblies across 9 species, annotation bundled":
        "9 个物种共 18 个装配，注释随包内置",
    "Gene models with transcript expansion, cytobands, GC and sequence tracks":
        "基因模型可展开转录本，另有细胞遗传带、GC 与序列轨道",
    "bigWig and bedGraph signal tracks, multi-sample overlays":
        "bigWig / bedGraph 信号轨道，支持多样本叠加",
    "Import your own bigWig, bedGraph, BAM, GTF or FASTA at runtime":
        "运行时可导入自己的 bigWig、bedGraph、BAM、GTF 或 FASTA",
    "Split view, deep links, PNG / SVG / PDF export":
        "分屏视图、深链接，导出 PNG / SVG / PDF",
    "This documentation is available in English and Chinese. Use the language selector in the bottom-left corner of the page to switch between ``English`` and ``简体中文``. The Chinese translation lives at ``/zh-cn/latest/`` on the same site.":
        "本文档提供英文和中文两个版本。用页面左下角的语言选择器在 ``English`` 与 "
        "``简体中文`` 之间切换，中文版位于同一站点的 ``/zh-cn/latest/``。",
    "Indices": "索引",
    ":ref:`genindex`": "",
    ":ref:`search`": "",
}

FAQ = {
    "FAQ": "常见问题",
    "The sequence and GC tracks are grey": "序列和 GC 轨道是灰色的",
    "Those tracks need sequence, and sequence is fetched from UCSC. Check that:":
        "这两条轨道需要序列，而序列是从 UCSC 拉取的。请确认：",
    "the machine has network access,": "机器能访问网络；",
    "``ORBIT_OFFLINE`` is not set to ``1``,": "``ORBIT_OFFLINE`` 没有被设成 ``1``；",
    "the assembly has a ``twoBitURL`` in ``data/catalog.json``.":
        "该装配在 ``data/catalog.json`` 里有 ``twoBitURL``。",
    "Genes, cytobands, search and imported tracks do not need sequence and keep working either way.":
        "基因、细胞遗传带、搜索和导入的轨道都不依赖序列，无论如何都能正常工作。",
    "Loading a locus is slow the first time": "第一次加载位点比较慢",
    "That is the range request fetching the 2bit index and the blocks for the window. The first visit to a chromosome takes about a second; moving within it afterwards is roughly 0.3 seconds. If every move is slow, the machine is probably re-resolving DNS — try a local FASTA.":
        "这是 Range 请求在取 2bit 索引和窗口覆盖的数据块。首次访问某条染色体约 1 秒，"
        "之后在该染色体上移动约 0.3 秒。如果每次移动都很慢，多半是 DNS 反复解析"
        "——改用本地 FASTA 试试。",
    "macOS says the app is damaged": "macOS 提示应用已损坏",
    "The build is not notarized, so Gatekeeper quarantines it. Run once::":
        "构建产物没有做公证，被 Gatekeeper 隔离了。执行一次：",
    "Windows SmartScreen blocked the installer": "Windows SmartScreen 拦截了安装包",
    "The installer is not code-signed. Choose **More info → Run anyway**.":
        "安装包没有代码签名。选择 **更多信息 → 仍要运行**。",
    "The window opens but stays blank": "窗口打开了但一片空白",
    "Check ``orbit.log`` in the settings directory (see :doc:`installation`). A blank window almost always means the backend failed to start — usually a port already in use. Launch with ``--port 8766`` and see whether it comes up.":
        "查看设置目录下的 ``orbit.log``，见 :doc:`installation`。白屏几乎总是后端没起来"
        "——通常是端口被占用。用 ``--port 8766`` 启动试试能否正常打开。",
    "Where are my settings stored?": "设置存在哪里？",
    "``%LOCALAPPDATA%\\Orbit`` on Windows, ``~/Library/Application Support/Orbit`` on macOS. Delete the folder to reset everything; the app recreates it on next launch. Set ``ORBIT_HOME`` to use a different location.":
        "Windows 在 ``%LOCALAPPDATA%\\Orbit``，macOS 在 "
        "``~/Library/Application Support/Orbit``。删掉这个目录即可重置一切，"
        "应用下次启动会重新创建。设置 ``ORBIT_HOME`` 可以换位置。",
    "Why does a gene label overlap the feature?": "为什么基因名字会压在特征上？",
    "When the name does not fit beside the feature, it is drawn on top of it with a translucent background rather than being truncated to ``NM_00…``. That is deliberate: a shortened accession is worse than a slightly busy label.":
        "当名字在特征旁边放不下时，会带半透明底板压在特征上，而不是截断成 ``NM_00…``。"
        "这是有意为之：缩短的编号比稍微拥挤的标签更糟。",
    "Can I use my own genome?": "可以用自己的基因组吗？",
    "Yes — add an entry to ``data/catalog.json`` and a local FASTA, as described in :doc:`assemblies`. Any assembly UCSC hosts also works by pointing ``twoBitURL`` at its 2bit file.":
        "可以——按 :doc:`assemblies` 所述，在 ``data/catalog.json`` 里加一条并准备本地 "
        "FASTA。UCSC 上有的装配，把 ``twoBitURL`` 指向它的 2bit 文件也能直接用。",
    "Why is there no batch export?": "为什么没有批量导出？",
    "Split view covers most of the need: up to four loci in one canvas, one export. A real batch mode would need a separate renderer that does not depend on the window, which is a larger change than it looks.":
        "分屏视图已经覆盖了大部分需求：最多四个位点画在同一块画布上，一次导出。"
        "真正的批量模式需要一个不依赖窗口的独立渲染器，改动比看上去大。",
    "Can I run two instances at once?": "能同时开两个实例吗？",
    "Yes, with different ports and different state directories::":
        "可以，用不同的端口和不同的状态目录：",
    "Does it work offline?": "能离线用吗？",
    "With a local FASTA or 2bit, yes. Set ``ORBIT_OFFLINE=1`` to make sure nothing tries to reach the network.":
        "配合本地 FASTA 或 2bit 就可以。设 ``ORBIT_OFFLINE=1`` 可确保不会去连网络。",
}

EXPORT = {
    "Exporting": "导出",
    "The export button captures exactly what is on screen — same colours, same labels, same zoom — and writes it to a file.":
        "导出按钮抓取的就是屏幕上看到的内容——同样的配色、同样的标签、同样的缩放"
        "——写进文件。",
    "Formats": "格式",
    "Format": "格式",
    "Extension": "扩展名",
    "When to use it": "适用场景",
    "PNG": "PNG",
    "``.png``": "``.png``",
    "Slides, quick sharing. Rendered at the current device pixel ratio, so it stays sharp on a HiDPI display.":
        "做幻灯片、快速分享。按当前设备像素比渲染，在高分屏上依然清晰。",
    "SVG": "SVG",
    "``.svg``": "``.svg``",
    "Editing in Illustrator or Inkscape. Text stays text, strokes stay strokes.":
        "需要在 Illustrator 或 Inkscape 里编辑。文字还是文字，描边还是描边。",
    "PDF": "PDF",
    "``.pdf``": "``.pdf``",
    "Journal figures. Vector, with an embedded font.":
        "期刊插图。矢量，字体已嵌入。",
    "File names are generated from the locus so you can export several views without renaming anything::":
        "文件名按位点自动生成，导多个视图不用手动改名：",
    "What is included": "导出内容",
    "Every visible track, in the same order and with the same heights":
        "所有可见轨道，顺序和高度都与屏幕一致",
    "Track labels and the axis on the left":
        "左侧的轨道标签和坐标轴",
    "Split view: all panes side by side, at their on-screen widths":
        "分屏时所有面板按屏幕宽度并排",
    "The selection highlight, if there is one":
        "选区高亮（如果有）",
    "Hidden tracks are not exported. If you want a figure without the ruler, uncheck it first — the export is a photograph of the window, not a separate renderer with its own options.":
        "隐藏的轨道不会被导出。想去掉标尺就先把它取消勾选——导出是窗口的"
        "「照片」，不是另有一套选项的独立渲染器。",
    "Vector export notes": "矢量导出的几点说明",
    "SVG and PDF are drawn with real vector primitives, not by embedding a bitmap. A few consequences are worth knowing:":
        "SVG 和 PDF 用真正的矢量图元绘制，不是嵌一张位图。有几点后果值得知道：",
    "Signal tracks become one path per sample, so they scale cleanly":
        "信号轨道每个样本一条路径，缩放后依然干净",
    "Gene models keep their exon rectangles and arrows as separate objects":
        "基因模型的外显子矩形和箭头都是独立对象",
    "Dense labels are laid out exactly as on screen, including the ones that sit on top of features — the export does not re-flow text":
        "标签排版与屏幕完全一致，包括压在特征上的那些——导出不会重排文字",
    "Very large exports (a whole chromosome at base resolution) produce large files; export a window instead":
        "超大范围导出（整条染色体到碱基分辨率）文件会很大；建议只导一个窗口",
    "For a publication figure, zoom until the scale reads something like ``10 bp/px``, then export SVG. Illustrator opens it with every label still editable, so you can nudge a gene name without redrawing anything.":
        "做发表用的图，先放大到比例尺显示 ``10 bp/px`` 左右，再导 SVG。"
        "Illustrator 打开后每个标签都可编辑，挪一下基因名不用重画。",
    "Batch export": "批量导出",
    "There is no batch mode yet. For many views, use split view to place up to four loci in one canvas and export once — each pane keeps its own coordinates.":
        "目前没有批量模式。要导很多视图时，用分屏把最多四个位点放进同一块画布一次导出"
        "——每个面板保留各自的坐标。",
}

apply("index.po", INDEX)
apply("faq.po", FAQ)
apply("data-export.po", EXPORT)
