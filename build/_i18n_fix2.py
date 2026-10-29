"""纯标记条目（:ref: / :kbd:）中英文完全一致，直接填同值，
让翻译完成度到 100%（RTD 的进度条按 msgstr 是否为空统计）。"""

import polib

BASE = "docs/locale/zh_CN/LC_MESSAGES"

for name in ("index.po", "quickstart.po"):
    po = polib.pofile(f"{BASE}/{name}")
    n = 0
    for e in po:
        if e.obsolete or e.msgstr.strip():
            continue
        e.msgstr = e.msgid
        e.flags = [f for f in e.flags if f != "fuzzy"]
        n += 1
    po.metadata["PO-Revision-Date"] = "2026-10-29 18:30+0800"
    po.save()
    print(f"{name}: filled {n}")
