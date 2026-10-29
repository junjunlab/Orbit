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
release = "1.0.1"

# The Chinese site is a separate Read the Docs project (a "translation") pointing at
# this same repository. Read the Docs exports READTHEDOCS_LANGUAGE for every build,
# so the translation project renders zh_CN without duplicating this file.
# Local builds are unaffected: ``sphinx-build -D language=zh_CN`` still wins, and
# without the env var we fall back to English.
language = os.environ.get("READTHEDOCS_LANGUAGE") or "en"

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

intersphinx_mapping = {"python": ("https://docs.python.org/3", None)}

exclude_patterns = ["_build", "Thumbs.db", ".DS_Store", "ui-review"]

# RTD serves the flyout itself; this only affects local builds.
html_context = {
    "display_github": True,
    "github_user": "junjunlab",
    "github_repo": "Orbit",
    "github_version": "main",
    "conf_py_path": "/docs/",
}
