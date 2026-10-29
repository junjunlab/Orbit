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


ASM = {
    "Assemblies": "装配",
    "Orbit bundles annotation for 18 assemblies across 9 species. Sequence is not bundled — it is streamed from UCSC on demand, which is what keeps the download small.":
        "Orbit 内置 9 个物种共 18 个装配的注释。序列不打包"
        "——按需从 UCSC 流式读取，这也是下载体积小的原因。",
    "Bundled assemblies": "内置装配",
    "Species": "物种",
    "Current": "当前版",
    "Previous": "上一版",
    "Source": "来源",
    "Human": "人",
    "``hg38``": "``hg38``",
    "``hg19``": "``hg19``",
    "UCSC refGene": "UCSC refGene",
    "Mouse": "小鼠",
    "``mm39``": "``mm39``",
    "``mm10``": "``mm10``",
    "Rat": "大鼠",
    "``rn7``": "``rn7``",
    "``rn6``": "``rn6``",
    "Zebrafish": "斑马鱼",
    "``danRer11``": "``danRer11``",
    "``danRer10``": "``danRer10``",
    "Fly": "果蝇",
    "``dm6``": "``dm6``",
    "``dm3``": "``dm3``",
    "Worm": "线虫",
    "``ce11``": "``ce11``",
    "``ce10``": "``ce10``",
    "Yeast": "酵母",
    "``sacCer3``": "``sacCer3``",
    "``sacCer2``": "``sacCer2``",
    "Frog": "爪蟾",
    "``xenTro10``": "``xenTro10``",
    "``xenTro9``": "``xenTro9``",
    "Chicken": "鸡",
    "``galGal6``": "``galGal6``",
    "``galGal5``": "``galGal5``",
    "Each assembly carries gene models, cytobands, chromosome sizes and the primary chromosome order used by the overview panel.":
        "每个装配都带基因模型、细胞遗传带、染色体长度，"
        "以及总览面板使用的主染色体顺序。",
    "How sequence is fetched": "序列怎么取",
    "Every assembly in ``data/catalog.json`` records a ``twoBitURL`` pointing at the UCSC 2bit file. When you navigate, Orbit issues an HTTP Range request for just the bytes covering the window and decodes them locally.":
        "``data/catalog.json`` 里每个装配都记录了一个指向 UCSC 2bit 文件的 "
        "``twoBitURL``。导航时 Orbit 只对窗口覆盖的字节发 HTTP Range 请求，"
        "在本地解码。",
    "First visit to a chromosome: about one second":
        "首次访问某条染色体：约 1 秒",
    "Subsequent moves within it: about 0.3 seconds":
        "之后在其上移动：约 0.3 秒",
    "Nothing is written to disk; the range cache is in memory and per session":
        "不写磁盘；Range 缓存在内存里，随会话结束而消失",
    "If the network is unavailable, the sequence and GC tracks go grey and everything else keeps working.":
        "网络不可用时，序列和 GC 轨道变灰，其余功能照常。",
    "Offline mode": "离线模式",
    "Set ``ORBIT_OFFLINE=1`` before launching to forbid network access. Combined with a local FASTA or 2bit, this gives a fully air-gapped browser::":
        "启动前设置 ``ORBIT_OFFLINE=1`` 即可禁止联网。"
        "配合本地 FASTA 或 2bit，就是一个完全隔离的浏览器：",
    "With no local sequence the GC and sequence tracks stay disabled, but genes, cytobands, search and imported tracks are unaffected.":
        "没有本地序列时，GC 和序列轨道保持禁用，"
        "但基因、细胞遗传带、搜索和导入的轨道不受影响。",
    "Adding your own assembly": "添加自己的装配",
    "Edit ``data/catalog.json`` and add an entry alongside the existing ones:":
        "编辑 ``data/catalog.json``，在现有条目旁边加一条：",
    "Then place ``genes.igvbin`` and ``cytoband.json`` under ``data/ann/myAssembly/``. The binary index is produced by the build scripts in ``build/``; see :doc:`how-it-works` for the format.":
        "然后把 ``genes.igvbin`` 和 ``cytoband.json`` 放到 "
        "``data/ann/myAssembly/`` 下。二进制索引由 ``build/`` 里的构建脚本生成；"
        "格式见 :doc:`how-it-works`。",
    "Restart Orbit and the assembly appears in the selector. Nothing else needs to change — the frontend reads the catalog, not a hard-coded list.":
        "重启 Orbit，装配就会出现在选择器里。其它都不用改"
        "——前端读的是 catalog，不是硬编码列表。",
}

NAV = {
    "Navigation": "导航",
    "Moving around a genome is the part you do most, so Orbit tries to make every route to a locus one action long.":
        "在基因组上移动是你做得最多的操作，所以 Orbit 尽量让到达任意位点都只需一步。",
    "Search syntax": "搜索语法",
    "The search box accepts several forms and figures out which one you meant:":
        "搜索框接受多种写法，并自行判断你想表达哪一种：",
    "Input": "输入",
    "Result": "结果",
    "``TP53``": "``TP53``",
    "Jumps to the gene, case-insensitive": "跳到该基因，不区分大小写",
    "``chr17:7,668,402-7,687,550``": "``chr17:7,668,402-7,687,550``",
    "That interval on chr17": "chr17 上的这个区间",
    "``chr17:7668402-7687550``": "``chr17:7668402-7687550``",
    "Same, without thousands separators": "同上，不带千分位分隔符",
    "``7,668,402-7,687,550``": "``7,668,402-7,687,550``",
    "Uses the current chromosome": "使用当前染色体",
    "``chr17:7,668,402``": "``chr17:7,668,402``",
    "A single base, shown with a 50 bp flank": "单个碱基，两侧各留 50 bp",
    "``chr17``": "``chr17``",
    "The whole chromosome": "整条染色体",
    "If a gene symbol matches several genes, the first hit is used and a list of alternatives is offered. Press :kbd:`Enter` again to cycle through them.":
        "如果一个基因名匹配到多个基因，取第一个命中并给出候选列表。"
        "再按一次 :kbd:`Enter` 可在候选之间循环。",
    "Zooming and panning": "缩放与平移",
    "Mouse wheel zooms around the cursor": "滚轮以光标为中心缩放",
    "Dragging on the ruler pans; dragging on a gene selects a range":
        "在标尺上拖动平移；在基因上拖动则选中一个区间",
    ":kbd:`+` / :kbd:`-` zoom around the centre":
        ":kbd:`+` / :kbd:`-` 以中心缩放",
    "The zoom level is shown as base pairs per pixel, which is the honest measure of how much detail you are actually seeing":
        "缩放级别显示为每像素多少碱基，这是衡量你实际看清多少细节的诚实指标",
    "There is a hard limit at one base per pixel. Beyond that the sequence track takes over — it draws coloured bases instead of pretending to have more resolution.":
        "硬上限是每像素 1 个碱基。再往下就交给序列轨道"
        "——它画出带颜色的碱基，而不是假装还有更高分辨率。",
    "Split view": "分屏视图",
    "Split view shows up to four independent loci at once, each with its own chromosome, coordinates and selection. It is the fastest way to compare the same gene across samples, or to check that an event really is where you think it is.":
        "分屏可同时显示最多四个独立位点，各自有染色体、坐标和选区。"
        "比较不同样本间的同一基因，或确认某个事件是否真在你以为的位置，"
        "这是最快的办法。",
    "Choose *2*, *3* or *4* panes from the toolbar":
        "在工具栏选择 *2*、*3* 或 *4* 个面板",
    "Each pane keeps its own search state; :kbd:`Ctrl` + :kbd:`1` … :kbd:`4` focuses a pane":
        "每个面板保留各自的搜索状态；:kbd:`Ctrl` + :kbd:`1` … :kbd:`4` "
        "可切换到对应面板",
    "Tracks are shared — load a bigWig once and it appears in every pane":
        "轨道是共享的——载入一次 bigWig，所有面板都会出现",
    "The whole-genome overview is not split; it follows the focused pane":
        "全基因组总览不分屏，跟随当前聚焦的面板",
    "Deep links": "深链接",
    "Every view has a URL you can paste into a notebook or a chat:":
        "每个视图都有 URL，可以直接贴进笔记或聊天：",
    "Parameters:": "参数：",
    "Key": "参数",
    "Meaning": "含义",
    "``db``": "``db``",
    "Assembly id, for example ``hg38`` or ``mm39``":
        "装配 id，例如 ``hg38`` 或 ``mm39``",
    "``locus``": "``locus``",
    "A locus in any of the search-box forms":
        "位点，支持搜索框的所有写法",
    "``tracks``": "``tracks``",
    "Comma-separated track names to enable": "要启用的轨道名，逗号分隔",
    "When Orbit runs as a desktop window the address bar is not visible, but the link is still accepted: launch with ``--browser`` and the page reads the query string, or paste the locus part into the search box.":
        "以桌面窗口运行时看不到地址栏，但链接同样有效：加 ``--browser`` 启动，"
        "页面会读取查询串；或者把位点部分粘进搜索框。",
    "Transcript expansion": "转录本展开",
    "Click any gene to expand it into its transcripts. Expanded genes show exons, introns, CDS thickness, and the coding direction; the row grows from 32 to 54 pixels and the label is drawn on top of the feature when there is no room beside it.":
        "点任意基因即可展开它的转录本。展开后显示外显子、内含子、CDS 厚度和"
        "编码方向；行高从 32 px 变成 54 px，名字在特征旁边放不下时压在特征上。",
    "Click again to collapse": "再点一次收起",
    ":kbd:`Shift` + click expands every gene in the window":
        ":kbd:`Shift` + 点击可展开窗口内所有基因",
    "The expanded set is remembered across sessions": "展开状态会跨会话记住",
    "The whole-genome overview": "全基因组总览",
    "The overview at the bottom lists every primary chromosome as a horizontal bar whose length is proportional to the chromosome size, with the current window marked in colour. It starts collapsed as a single row for the current chromosome; press the chevron to expand all 25 rows. Clicking a bar navigates to that chromosome.":
        "底部的总览把每条主染色体画成一条横条，长度与染色体大小成正比，"
        "当前窗口用颜色标出。它默认折叠成当前染色体的单行；按箭头展开全部 25 行。"
        "点某条即跳到该染色体。",
}

apply("assemblies.po", ASM)
apply("navigation.po", NAV)
