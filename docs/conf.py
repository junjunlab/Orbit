"""Sphinx configuration for the Orbit documentation.

The source language is English; Chinese lives in ``docs/locale/zh_CN/LC_MESSAGES``
as gettext catalogues. Read the Docs renders the language flyout automatically
once a translated project is registered for this repository.
"""

import os

project = "Orbit"
author = "junjunlab"
copyright = "2026, junjunlab"

version = "1.0"
release = "1.0.2"

# The Chinese site is a separate Read the Docs project (a "translation") pointing at
# this same repository. Read the Docs exports READTHEDOCS_LANGUAGE for every build,
# so the translation project renders zh_CN without duplicating this file.
# Local builds are unaffected: ``sphinx-build -D language=zh_CN`` still wins, and
# without the env var we fall back to English.

# RTD 的语言代码是小写连字符（官方文档原话："in lowercase and uses a dash as a
# separator"，例如 zh-cn、pt-br），而 Sphinx 认的是下划线 + 大写地区码（zh_CN、
# pt_BR）。不归一化的话 Sphinx 会去找 locale/zh-cn/，找不到翻译目录 —— 站点能建
# 出来，但内容全是英文。
_RTD_TO_SPHINX = {
    "zh-cn": "zh_CN",
    "zh-hans": "zh_CN",
    "zh-hk": "zh_HK",
    "zh-tw": "zh_TW",
    "zh-hant": "zh_TW",
    "pt-br": "pt_BR",
    "pt-pt": "pt_PT",
    "sr-cyrl": "sr_Cyrl",
    "sr-latn": "sr_Latn",
    "de-at": "de_AT",
    "de-ch": "de_CH",
    "en-gb": "en_GB",
    "es-mx": "es_MX",
    "fr-ca": "fr_CA",
    "it-ch": "it_CH",
    "nl-be": "nl_BE",
}


def _detect_language() -> str:
    """这次构建该用哪种语言。"""
    code = (os.environ.get("READTHEDOCS_LANGUAGE") or "en").strip().lower()
    return _RTD_TO_SPHINX.get(code, code)


language = _detect_language()

extensions = [
    "sphinx.ext.intersphinx",
    "sphinx.ext.extlinks",
    "sphinx_copybutton",
]

# gettext / i18n ------------------------------------------------------------
locale_dirs = ["locale/"]
gettext_compact = False          # one .po per source document
gettext_uuid = False

# theme ---------------------------------------------------------------------
html_theme = "sphinx_rtd_theme"
html_title = "Orbit documentation"
html_short_title = "Orbit"
html_static_path = ["_static"]
html_css_files = ["custom.css"]
html_show_sourcelink = False

html_theme_options = {
    "navigation_depth": 3,
    "collapse_navigation": False,
    "sticky_navigation": True,
    "titles_only": False,
}

# The screenshot lives one level up, next to the repository README.
html_extra_path = []

extlinks = {
    "repo": ("https://github.com/junjunlab/Orbit%s", "%s"),
    "issue": ("https://github.com/junjunlab/Orbit/issues/%s", "issue #%s"),
}

# 本地无网络时 intersphinx 会拖垮整次构建（-W 下直接报错）；设 ORBIT_DOCS_OFFLINE=1
# 跳过它。RTD 有网络，不受影响。
intersphinx_mapping = (
    {} if os.environ.get("ORBIT_DOCS_OFFLINE") == "1"
    else {"python": ("https://docs.python.org/3", None)}
)


# 截图按界面语言分目录 --------------------------------------------------------
# 英文文档里放英文界面截图，中文文档里放中文界面截图，否则中文版会看到英文 UI、
# 英文版会看到中文 UI（这正是 1.0.2 文档第一版的问题）。
# 源文件统一写 ``examples/name.png``；构建时按当前语言改成
# ``examples/en/name.png`` 或 ``examples/zh/name.png``，找不到就退回原图，
# 这样新加图还没补双语时也不会构建失败。
def _pick_localized_figures(app, doctree):
    from pathlib import Path as _Path
    lang = (app.config.language or "en").lower()
    sub = "zh" if lang.startswith("zh") else "en"
    src = _Path(app.srcdir) / "examples" / sub
    if not src.is_dir():
        return
    from docutils import nodes
    for node in doctree.traverse(nodes.image):
        uri = node.get("uri") or ""
        if not uri.startswith("examples/") or uri.startswith("examples/" + sub + "/"):
            continue
        name = uri.split("/", 1)[1]
        if (src / name).exists():
            node["uri"] = f"examples/{sub}/{name}"


def setup(app):
    # 优先级要早于 Sphinx 的 ImageCollector（它默认 200），否则图片已经按旧路径
    # 收进 _images 了，改 uri 只会让 HTML 指向一个没被复制的文件。
    app.connect("doctree-read", _pick_localized_figures, priority=100)
    return {"parallel_read_safe": True}

exclude_patterns = ["_build", "Thumbs.db", ".DS_Store", "ui-review"]

# RTD serves the flyout itself; this only affects local builds.
html_context = {
    "display_github": True,
    "github_user": "junjunlab",
    "github_repo": "Orbit",
    "github_version": "main",
    "conf_py_path": "/docs/",
}
