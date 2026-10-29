"""修掉两处 RST 定界符问题：

1. 行内字面量（``...``）的结束定界符紧跟全角括号（（/））时，
   docutils 不把它当作 end-string，报 "Inline literal start-string without end-string"。
2. 角色（:doc:`...`）的结束反引号后紧跟全角右括号时，角色不会被解析，
   触发 i18n.inconsistent_references。

统一策略：让结束定界符后面跟 ASCII 空格 / 逗号 / 句号，或把全角括号换成 ASCII 括号。
"""

import polib

BASE = "docs/locale/zh_CN/LC_MESSAGES"

# --- 1. installation.po -----------------------------------------------------
po = polib.pofile(f"{BASE}/installation.po")
for e in po:
    if e.msgid.startswith("``%LOCALAPPDATA%"):
        e.msgstr = (
            "``%LOCALAPPDATA%\\Orbit`` (Windows)、"
            "``~/Library/Application Support/Orbit`` (macOS)"
        )
        print("installation ->", e.msgstr)
po.save()

# --- 2. faq.po --------------------------------------------------------------
po = polib.pofile(f"{BASE}/faq.po")
for e in po:
    if "orbit.log" in e.msgid and ":doc:" in e.msgid:
        e.msgstr = (
            "查看设置目录下的 ``orbit.log``，见 :doc:`installation`。"
            "白屏几乎总是后端没起来 —— 通常是端口被占用。"
            "用 ``--port 8766`` 启动试试能否正常打开。"
        )
        print("faq ->", e.msgstr)
po.save()
