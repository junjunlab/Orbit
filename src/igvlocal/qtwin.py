"""Qt 原生窗口（PySide6 + QtWebEngine）。

为什么用 Qt 而不是 pywebview：
  · QtWebEngine 自带整份 Chromium，渲染路径和 Chrome 完全一致 —— 前端那套
    Canvas / fetch / gzip 行为不需要任何适配（WebView2 那套在这里踩过坑：
    第一个 API 请求的响应体在 WebView2 里读不完，页面就白着）。
  · Qt 是 LGPL（PySide6 官方绑定），打包分发没有授权问题。
  · 顺带解决「导出文件」：QtWebEngine 的 downloadRequested 信号可以直接弹
    系统另存为对话框，前端一行都不用改。

代价：打包体积增加约 120–180 MB（QtWebEngine 本身）。

调用方（server.run）只需要 open_window(url)，失败会抛异常由上层降级。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

__all__ = ["available", "open_window", "state_dir"]

# 另存为对话框的过滤器（按导出扩展名给）
_FILTERS = {
    "png": "PNG 图片 (*.png)",
    "svg": "SVG 矢量图 (*.svg)",
    "pdf": "PDF 文档 (*.pdf)",
    "txt": "文本文件 (*.txt)",
    "tsv": "制表符分隔 (*.tsv)",
    "csv": "CSV 表格 (*.csv)",
    "bed": "BED 轨道 (*.bed)",
    "json": "JSON 文件 (*.json)",
}


def state_dir() -> Path:
    """Qt profile 目录（localStorage / 缓存），跨启动保留偏好。"""
    override = os.environ.get("ORBIT_HOME")
    if override:
        d = Path(override).expanduser()
        d.mkdir(parents=True, exist_ok=True)
        return d
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    d = base / "Orbit"
    try:
        d.mkdir(parents=True, exist_ok=True)
    except OSError:
        return Path.home() / ".orbit"
    return d


def available() -> bool:
    try:
        from PySide6.QtWebEngineWidgets import QWebEngineView  # noqa: F401
    except Exception:
        return False
    return True


def _icon_path() -> Path | None:
    """Locate assets/orbit.png in dev and in a frozen (PyInstaller) build."""
    for base in (Path(getattr(sys, "_MEIPASS", "")), Path(__file__).resolve().parents[2]):
        if not base:
            continue
        p = base / "assets" / "orbit.png"
        if p.is_file():
            return p
    return None


def _apply_icon(win) -> None:
    """Set the window/taskbar icon; quietly skip if the asset is missing."""
    try:
        from PySide6.QtGui import QIcon
    except Exception:
        return
    p = _icon_path()
    if p is not None:
        icon = QIcon(str(p))
        if not icon.isNull():
            win.setWindowIcon(icon)


def open_window(url: str, title: str = "Orbit", width: int = 1440, height: int = 900,
                debug: bool = False) -> None:
    """打开原生窗口，阻塞到用户关窗。失败时抛异常。"""
    from PySide6.QtCore import QUrl, Qt
    from PySide6.QtGui import QGuiApplication
    from PySide6.QtWebEngineCore import QWebEngineProfile, QWebEngineSettings
    from PySide6.QtWebEngineWidgets import QWebEngineView
    from PySide6.QtWidgets import QApplication, QFileDialog, QMainWindow

    # Qt 只认自己的命令行参数，把我们的 --port 之类剔掉
    app = QApplication.instance() or QApplication([sys.argv[0]])
    app.setApplicationName("Orbit")
    app.setApplicationDisplayName(title)

    store = state_dir()
    profile = QWebEngineProfile("Orbit", app)
    profile.setPersistentStoragePath(str(store / "qt-profile"))
    profile.setCachePath(str(store / "qt-cache"))
    profile.setHttpCacheType(QWebEngineProfile.HttpCacheType.DiskHttpCache)
    profile.setPersistentCookiesPolicy(
        QWebEngineProfile.PersistentCookiesPolicy.ForcePersistentCookies)

    win = QMainWindow()
    win.setWindowTitle(title)
    win.resize(width, height)
    win.setMinimumSize(960, 600)
    _apply_icon(win)

    view = QWebEngineView(win)
    view.setPage(_make_page(profile, view, debug))
    s = view.settings()
    s.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
    s.setAttribute(QWebEngineSettings.WebAttribute.LocalStorageEnabled, True)
    s.setAttribute(QWebEngineSettings.WebAttribute.JavascriptCanAccessClipboard, True)
    s.setAttribute(QWebEngineSettings.WebAttribute.ShowScrollBars, True)
    win.setCentralWidget(view)

    # 导出 PNG/SVG/PDF：前端用 <a download>，这里接住并弹系统另存为
    def on_download(item):
        suggested = item.downloadFileName() or "orbit-export"
        ext = Path(suggested).suffix.lower().lstrip(".")
        one = _FILTERS.get(ext)
        filters = f"{one};;所有文件 (*.*)" if one else "所有文件 (*.*)"
        start = Path.home() / "Downloads" / suggested
        path, _ = QFileDialog.getSaveFileName(win, "保存导出文件", str(start), filters)
        if not path:
            item.cancel()
            return
        p = Path(path)
        if ext and p.suffix.lower() != "." + ext:   # 用户把扩展名删掉了 → 补回来
            p = p.with_name(p.name + "." + ext)
        item.setDownloadDirectory(str(p.parent))
        item.setDownloadFileName(p.name)
        item.accept()

    profile.downloadRequested.connect(on_download)

    if debug:
        # 把页面里的 console 输出转发到终端（排查前端问题用）
        view.page().javaScriptConsoleMessage = _console_logger(view.page())

    # 调试：QTWEBENGINE_REMOTE_DEBUGGING=<port> 可开 CDP，用 Chrome DevTools 连
    view.load(QUrl(url))
    win.show()

    screen = QGuiApplication.primaryScreen()
    if screen:  # 居中，别一开就贴左上角
        geo = screen.availableGeometry()
        win.move(geo.center().x() - win.width() // 2,
                 max(geo.top(), geo.center().y() - win.height() // 2))

    app.exec()


def _make_page(profile, view, debug):
    from PySide6.QtWebEngineCore import QWebEnginePage
    page = QWebEnginePage(profile, view)
    if debug:
        page.javaScriptConsoleMessage = _console_logger(page)
    return page


def _console_logger(page):
    from PySide6.QtWebEngineCore import QWebEnginePage

    def handler(level, message, line, source):
        lvl = {QWebEnginePage.JavaScriptConsoleMessageLevel.InfoMessageLevel: "INFO",
               QWebEnginePage.JavaScriptConsoleMessageLevel.WarningMessageLevel: "WARN",
               QWebEnginePage.JavaScriptConsoleMessageLevel.ErrorMessageLevel: "ERROR"}.get(level, "LOG")
        sys.stderr.write(f"[js:{lvl}] {message}  ({source}:{line})\n")
        sys.stderr.flush()

    return handler


def _devtools_page(profile, view):
    from PySide6.QtWebEngineCore import QWebEnginePage
    from PySide6.QtWebEngineWidgets import QWebEngineView
    from PySide6.QtWidgets import QMainWindow

    dlg = QMainWindow(view)
    dlg.setWindowTitle("Orbit · DevTools")
    dv = QWebEngineView(dlg)
    dp = QWebEnginePage(profile, dv)
    dv.setPage(dp)
    dlg.setCentralWidget(dv)
    dlg.resize(1000, 700)
    dlg.show()
    return dp
