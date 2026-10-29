"""第四批（最后一批）中文翻译：interface / installation / building。

模式同 _i18n_1.py：按 msgid 精确匹配写入 msgstr，并清掉 fuzzy 标记。
"""

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
    po.metadata["PO-Revision-Date"] = "2026-10-29 18:00+0800"
    po.metadata["Last-Translator"] = "junjunlab"
    po.save()
    print(f"{name}: translated {len(mapping)}, missing {len(miss)}")
    for m in miss:
        print("   MISS:", m[:90])


INTERFACE = {
    "The interface": "界面",
    "The window is three regions: a toolbar on top, a column of track labels on the left, and one canvas per track filling the rest.": (
        "窗口分为三个区域：顶部是工具栏，左侧是一列轨道标签，其余空间由每条轨道各自的一块画布填满。"
    ),
    "Toolbar": "工具栏",
    "**Assembly selector** — switch genome; annotation reloads, sequence follows": (
        "**装配选择器** — 切换基因组；注释随之重新加载，序列也自动跟随"
    ),
    "**Search box** — locus, gene symbol, or a motif pattern": (
        "**搜索框** — 支持位点、基因符号或基序模式"
    ),
    "**Zoom controls** — plus, minus, and a fit-to-window button": (
        "**缩放控件** — 放大、缩小，以及一个适应窗口按钮"
    ),
    "**Export** — PNG, SVG or PDF for the current view": (
        "**导出** — 把当前视图存成 PNG、SVG 或 PDF"
    ),
    "**Split view** — show two, three or four independent loci side by side": (
        "**分屏视图** — 并排显示两、三或四个相互独立的位点"
    ),
    "Track labels": "轨道标签",
    "Every track has a label cell on the left. The label carries:": (
        "每条轨道左侧都有一个标签格。标签中包含："
    ),
    "a checkbox to show or hide the track,": "显示或隐藏该轨道的复选框，",
    "the track name (click to open settings),": "轨道名称（点击可打开设置），",
    "a one-line summary — gene count, signal range, or data source,": (
        "一行摘要 — 基因数量、信号范围或数据来源，"
    ),
    "for imported tracks, a menu with *remove*, *rename* and *reload*.": (
        "对于导入的轨道，还有一个菜单，包含 *移除*、*重命名* 和 *重新加载*。"
    ),
    "Track types": "轨道类型",
    "Track": "轨道",
    "What it draws": "绘制内容",
    "Ideogram": "染色体示意图",
    "Cytobands for the whole chromosome, with a marker for the visible window": (
        "整条染色体的细胞遗传带，并用标记框出当前可见范围"
    ),
    "Ruler": "标尺",
    "Tick marks and coordinates; the scale switches units as you zoom": (
        "刻度线与坐标；缩放时刻度会自动切换单位"
    ),
    "RefSeq genes": "RefSeq 基因",
    "Gene models; click a gene to expand its transcripts": (
        "基因模型；点击某个基因可展开其转录本"
    ),
    "Signal": "信号",
    "bigWig or bedGraph values as a filled area, autoscaled or fixed": (
        "以填充面积形式绘制 bigWig 或 bedGraph 数值，可自动缩放或固定范围"
    ),
    "GC content": "GC 含量",
    "GC percentage in windows across the visible range": (
        "按窗口统计可见范围内的 GC 百分比"
    ),
    "Sequence": "序列",
    "Coloured bases, shown once each base has enough pixels": (
        "彩色碱基；只有当每个碱基分到足够像素时才会显示"
    ),
    "Gene track settings": "基因轨道设置",
    "Click the gene track label to open its panel.": "点击基因轨道标签即可打开其设置面板。",
    "Setting": "设置项",
    "Effect": "作用",
    "Display mode": "显示模式",
    "*Expanded* draws every transcript; *Collapsed* draws one row per gene": (
        "*展开* 绘制每个转录本；*折叠* 每个基因只占一行"
    ),
    "Colour by": "着色依据",
    "Strand, or a single colour": "按链着色，或统一使用单一颜色",
    "Labels": "标签",
    "Show gene symbols, transcript accessions, or nothing": (
        "显示基因符号、转录本编号，或什么都不显示"
    ),
    "Height": "高度",
    "Row height in pixels, which also controls how many genes fit": (
        "行高（像素），同时也决定了能容纳多少基因"
    ),
    "Signal track settings": "信号轨道设置",
    "Scale": "刻度",
    "*Autoscale* fits the visible window; *Fixed* pins the range": (
        "*自动* 随可见窗口调整；*固定* 则锁定范围"
    ),
    "Range": "范围",
    "Min and max when the scale is fixed": "刻度固定时的最小值与最大值",
    "Colour": "颜色",
    "Per-track colour; groups can share one tint": (
        "按轨道单独设色；同一分组可共用一种色调"
    ),
    "Draw mode": "绘制方式",
    "Filled area, bar, or line": "填充面积、柱状或折线",
    "Overlay": "叠加",
    "Stack tracks, or overlay several samples in one row": (
        "轨道上下堆叠，或把多个样本叠加在同一行"
    ),
    "Display options": "显示选项",
    "The appearance menu toggles the dark theme, the label density, and whether the whole-genome overview starts expanded. Preferences are stored per user and restored on the next launch.": (
        "外观菜单可切换深色主题、标签密度，以及全基因组总览是否默认展开。"
        "偏好按用户保存，下次启动时自动恢复。"
    ),
}

INSTALLATION = {
    "Installation": "安装",
    "Pick the package for your platform from the `Releases page <https://github.com/junjunlab/Orbit/releases>`_.": (
        "在 `发布页面 <https://github.com/junjunlab/Orbit/releases>`_ 中选择适合你平台的安装包。"
    ),
    "Platform": "平台",
    "File": "文件",
    "Size": "大小",
    "Windows 10/11 x64": "Windows 10/11 x64",
    "``Orbit-1.0.0-Windows-x64-Setup.exe``": "``Orbit-1.0.0-Windows-x64-Setup.exe``",
    "~150 MB": "约 150 MB",
    "macOS, Apple Silicon": "macOS，Apple Silicon",
    "``Orbit-1.0.0-macOS-arm64.dmg``": "``Orbit-1.0.0-macOS-arm64.dmg``",
    "~244 MB": "约 244 MB",
    "macOS, Intel": "macOS，Intel",
    "``Orbit-1.0.0-macOS-x86_64.dmg``": "``Orbit-1.0.0-macOS-x86_64.dmg``",
    "~253 MB": "约 253 MB",
    "Windows": "Windows",
    "Run the installer. It is a **per-user** installation: no administrator rights are required and nothing is written outside your profile.": (
        "运行安装程序。这是**按用户**安装：不需要管理员权限，"
        "也不会向用户目录之外写入任何内容。"
    ),
    "Program files: ``%LOCALAPPDATA%\\Programs\\Orbit``": (
        "程序文件：``%LOCALAPPDATA%\\Programs\\Orbit``"
    ),
    "Settings and logs: ``%LOCALAPPDATA%\\Orbit``": (
        "设置与日志：``%LOCALAPPDATA%\\Orbit``"
    ),
    "The installer offers a desktop shortcut (off by default) and can launch Orbit when it finishes.": (
        "安装程序可选择创建桌面快捷方式（默认关闭），并在结束时可直接启动 Orbit。"
    ),
    'The executable is not code-signed, so Windows SmartScreen may show *"Windows protected your PC"*. Choose **More info → Run anyway**.': (
        "可执行文件未做代码签名，Windows SmartScreen 可能弹出 "
        '*"Windows 已保护你的电脑"*。请选择 **更多信息 → 仍要运行**。'
    ),
    "macOS": "macOS",
    "Open the ``.dmg`` and drag **Orbit** into *Applications*.": (
        "打开 ``.dmg``，把 **Orbit** 拖入 *应用程序*。"
    ),
    "The build is ad-hoc signed but **not notarized**, so the first launch is blocked by Gatekeeper. Either:": (
        "该构建只做了临时签名（ad-hoc），**未经过公证**，因此首次启动会被 Gatekeeper 拦截。"
        "可以任选一种方式："
    ),
    "right-click (or Control-click) the app and choose **Open**, then confirm, or": (
        "右键（或按住 Control 点击）应用图标，选择 **打开**，然后确认；或者"
    ),
    "run once in Terminal::": "在终端中执行一次::",
    "If macOS reports the app is *damaged and can't be opened*, the quarantine attribute is the cause — the ``xattr`` command above fixes it.": (
        "如果 macOS 提示应用 *已损坏，无法打开*，那是隔离属性（quarantine）导致的 — "
        "上面那条 ``xattr`` 命令即可解决。"
    ),
    "Command line": "命令行",
    "The frozen build accepts the same options as the Python module, which is handy for scripts and for running several instances side by side.": (
        "打包后的程序接受与 Python 模块相同的选项，便于写脚本，"
        "也便于同时运行多个实例。"
    ),
    "Option": "选项",
    "Meaning": "含义",
    "``--data PATH``": "``--data PATH``",
    "Use another data directory instead of the bundled one": (
        "改用其他数据目录，而不是随包附带的那一份"
    ),
    "``--port N``": "``--port N``",
    "Listen on a different port (default ``8765``)": "监听其他端口（默认 ``8765``）",
    "``--host HOST``": "``--host HOST``",
    "Bind address (default ``127.0.0.1``)": "绑定地址（默认 ``127.0.0.1``）",
    "``--browser``": "``--browser``",
    "Open the system browser instead of the native window": (
        "改用系统浏览器打开，而不是原生窗口"
    ),
    "``--no-browser``": "``--no-browser``",
    "Headless: serve the API only": "无界面模式：只提供 API 服务",
    "``--debug``": "``--debug``",
    "Verbose logging, plus JavaScript console output from the window": (
        "输出详细日志，并把窗口中的 JavaScript 控制台信息一并打印"
    ),
    "Example — two instances, separate state, different ports::": (
        "示例 — 两个实例、各自独立的状态、不同端口::"
    ),
    "``ORBIT_HOME`` moves the settings and cache directory, so instances do not share preferences.": (
        "``ORBIT_HOME`` 用于改变设置与缓存目录，这样多个实例不会共用偏好。"
    ),
    "Where things are stored": "文件存放位置",
    "What": "内容",
    "Location": "位置",
    "Preferences, session, Qt cache": "偏好设置、会话、Qt 缓存",
    "``%LOCALAPPDATA%\\Orbit`` (Windows), ``~/Library/Application Support/Orbit`` (macOS)": (
        "``%LOCALAPPDATA%\\Orbit``（Windows）、"
        "``~/Library/Application Support/Orbit``（macOS）"
    ),
    "Application log": "应用日志",
    "``orbit.log`` in the directory above": "位于上述目录中的 ``orbit.log``",
    "Annotation and assemblies": "注释与装配",
    "``data/`` next to the executable": "可执行文件旁边的 ``data/``",
    "Uninstalling": "卸载",
    "Use *Add or remove programs* on Windows, or move the app to the Bin on macOS. User data in ``%LOCALAPPDATA%\\Orbit`` is left in place; delete it manually if you want a clean slate.": (
        "Windows 上使用 *添加或删除程序*，macOS 上把应用移到废纸篓即可。"
        "``%LOCALAPPDATA%\\Orbit`` 中的用户数据会被保留；若想彻底清理，请手动删除。"
    ),
}

BUILDING = {
    "Building from source": "从源码构建",
    "Running it": "运行",
    "Orbit needs Python 3.10 or newer and PySide6. Everything else is standard library.": (
        "Orbit 需要 Python 3.10 或更高版本以及 PySide6，其余全部是标准库。"
    ),
    "Freezing": "打包冻结",
    "``build/make_exe.py`` wraps PyInstaller and is the single entry point for both platforms.": (
        "``build/make_exe.py`` 封装了 PyInstaller，是两个平台唯一的入口脚本。"
    ),
    "``--no-genomes`` skips the ``*.2bit`` files, so the bundle carries annotation only and sequence comes from UCSC. This is what the installers use.": (
        "``--no-genomes`` 会跳过 ``*.2bit`` 文件，因此包内只带注释，序列从 UCSC 获取。"
        "正式安装包就是这样构建的。"
    ),
    "``--windowed`` builds a GUI executable with no console window.": (
        "``--windowed`` 生成不带控制台窗口的图形界面程序。"
    ),
    "Without either flag you get a console build with local sequence — useful for debugging.": (
        "两个参数都不加时，得到的是带本地序列的控制台版本 — 便于调试。"
    ),
    "The script handles the platform differences that PyInstaller does not:": (
        "脚本处理了 PyInstaller 本身不处理的平台差异："
    ),
    "Difference": "差异点",
    "Handling": "处理方式",
    "``--add-data`` separator": "``--add-data`` 的分隔符",
    "``;`` on Windows, ``:`` on macOS": "Windows 用 ``;``，macOS 用 ``:``",
    "Output layout": "输出结构",
    "``dist/Orbit/`` on Windows, ``dist/Orbit.app`` on macOS": (
        "Windows 为 ``dist/Orbit/``，macOS 为 ``dist/Orbit.app``"
    ),
    "Data location": "数据位置",
    "``data/`` next to the executable, which is ``Contents/MacOS`` inside the bundle": (
        "``data/`` 位于可执行文件旁，在应用包内即 ``Contents/MacOS``"
    ),
    "Bundle id": "包标识",
    "``--osx-bundle-identifier`` is passed on macOS only": (
        "仅在 macOS 上传入 ``--osx-bundle-identifier``"
    ),
    "Windows installer": "Windows 安装包",
    "Requires `Inno Setup 6 <https://jrsoftware.org/isinfo.php>`_.": (
        "需要 `Inno Setup 6 <https://jrsoftware.org/isinfo.php>`_。"
    ),
    "Produces ``dist\\installer\\Orbit-1.0.0-Windows-x64-Setup.exe``. The script is a per-user install (``PrivilegesRequired=lowest``), which avoids the UAC prompt and lets the app write to its own data directory.": (
        "产物为 ``dist\\installer\\Orbit-1.0.0-Windows-x64-Setup.exe``。"
        "安装脚本按用户安装（``PrivilegesRequired=lowest``），"
        "既能避开 UAC 提示，也让应用可以写入自己的数据目录。"
    ),
    'Inno Setup does not ship a Simplified Chinese language file, so ``installer/ChineseSimplified.isl`` is kept in the repository and referenced by a relative path. Without it the compiler fails with *"Couldn\'t open include file"*.': (
        "Inno Setup 并不自带简体中文语言文件，"
        "因此把 ``installer/ChineseSimplified.isl`` 一并放进仓库，并用相对路径引用。"
        '缺少它时编译器会报 *"Couldn\'t open include file"*。'
    ),
    "macOS disk image": "macOS 磁盘映像",
    "The script ad-hoc signs the bundle, clears extended attributes, stages the app with an ``/Applications`` symlink, and calls ``hdiutil``. Ad-hoc signing is not optional: on Apple Silicon an unsigned arm64 binary is killed on launch.": (
        "脚本会对应用包做临时签名、清除扩展属性、"
        "把应用和指向 ``/Applications`` 的符号链接摆好，然后调用 ``hdiutil``。"
        "临时签名不是可选项：在 Apple Silicon 上，未签名的 arm64 二进制一启动就会被系统杀掉。"
    ),
    "Shipping without the Gatekeeper warning needs an Apple Developer certificate and a notarization step, neither of which the project has.": (
        "若想彻底消除 Gatekeeper 提示，需要 Apple 开发者证书和公证流程，"
        "本项目两者都不具备。"
    ),
    "Continuous integration": "持续集成",
    "``.github/workflows/build.yml`` builds all three packages on every tag.": (
        "``.github/workflows/build.yml`` 会在每次打 tag 时构建全部三个安装包。"
    ),
    "Job": "任务",
    "Runner": "运行器",
    "Produces": "产物",
    "Windows-x64": "Windows-x64",
    "``windows-latest``": "``windows-latest``",
    "Inno Setup installer": "Inno Setup 安装程序",
    "macOS-arm64": "macOS-arm64",
    "``macos-15``": "``macos-15``",
    "arm64 disk image": "arm64 磁盘映像",
    "macOS-x64": "macOS-x64",
    "``macos-15-intel``": "``macos-15-intel``",
    "Intel disk image": "Intel 磁盘映像",
    "Publish release": "发布 Release",
    "``ubuntu-latest``": "``ubuntu-latest``",
    "Collects all three and attaches them to the release": (
        "汇总三个产物并附加到 Release 上"
    ),
    "The release step is a separate job on purpose. Running it inside the matrix means three jobs publish concurrently, which duplicates the release notes and races on the same assets.": (
        "发布步骤特意拆成独立任务。若放在矩阵内部，三个任务会同时发布，"
        "导致发布说明重复、并互相争抢同一批资产。"
    ),
    "Runner labels are easy to get wrong. ``macos-15`` is Apple Silicon, ``macos-15-intel`` is Intel, and ``macos-15-arm64`` is not a label at all — a job using it queues forever.": (
        "运行器标签很容易搞错。``macos-15`` 是 Apple Silicon，"
        "``macos-15-intel`` 是 Intel，而 ``macos-15-arm64`` 根本不是标签 — "
        "用它写的任务会永远排队。"
    ),
    "Releasing": "发版",
    "The tag push triggers the build and attaches the three packages to a new release. Nothing is published for ordinary pushes to ``main``.": (
        "推送 tag 会触发构建，并把三个安装包附加到新的 Release 上。"
        "普通推送到 ``main`` 不会发布任何东西。"
    ),
    "Building the documentation": "构建文档",
    "The English build is the source; Chinese comes from the gettext catalogues in ``docs/locale/zh_CN/LC_MESSAGES``.": (
        "英文构建是源语言；中文来自 ``docs/locale/zh_CN/LC_MESSAGES`` 下的 gettext 目录。"
    ),
    "To refresh the catalogues after editing a page:": "修改页面后，刷新目录文件：",
    "Then translate the new ``msgid`` entries and rebuild with ``-D language=zh_CN``.": (
        "然后翻译新增的 ``msgid`` 条目，并用 ``-D language=zh_CN`` 重新构建。"
    ),
}

apply("interface.po", INTERFACE)
apply("installation.po", INSTALLATION)
apply("building.po", BUILDING)
