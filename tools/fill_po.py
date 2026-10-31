"""把 JSON 里的中文译文填进 .po（按 msgid 精确匹配，只填空的 msgstr）。

用法：python tools/fill_po.py <po> <json>
JSON 形如 {"英文 msgid": "中文译文", ...}
"""
import ast
import json
import re
import sys
from pathlib import Path


def parse_simple(text):
    entries = []
    for blk in re.split(r"\n\s*\n", text):
        lines = [l for l in blk.splitlines() if l.strip() and not l.startswith("#")]
        if not lines:
            continue
        mid = mstr = None
        target = None
        for l in lines:
            if l.startswith("msgid "):
                target, piece = "id", ast.literal_eval(l[6:].strip())
                mid = piece if mid is None else mid + piece
            elif l.startswith("msgstr "):
                target, piece = "str", ast.literal_eval(l[7:].strip())
                mstr = piece if mstr is None else mstr + piece
            elif l.startswith('"'):
                piece = ast.literal_eval(l.strip())
                if target == "id":
                    mid = (mid or "") + piece
                elif target == "str":
                    mstr = (mstr or "") + piece
        if mid is not None:
            entries.append([mid, mstr or ""])
    return entries


def esc(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


po_p = Path(sys.argv[1])
tr = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
entries = parse_simple(po_p.read_text(encoding="utf-8"))

filled, unknown = 0, []
used = set()
for e in entries:
    if not e[1] and e[0] in tr:
        e[1] = tr[e[0]]
        used.add(e[0])
        filled += 1
for k in tr:
    if k not in used:
        unknown.append(k)

header = ('msgid ""\nmsgstr ""\n'
          '"Project-Id-Version: Orbit\\n"\n'
          '"Language: zh_CN\\n"\n'
          '"MIME-Version: 1.0\\n"\n'
          '"Content-Type: text/plain; charset=UTF-8\\n"\n'
          '"Content-Transfer-Encoding: 8bit\\n"\n'
          '"Plural-Forms: nplurals=1; plural=0;\\n"\n')
out = [header]
for mid, mstr in entries:
    out.append("msgid " + esc(mid))
    out.append("msgstr " + esc(mstr))
    out.append("")
po_p.write_text("\n".join(out), encoding="utf-8")
print(f"filled {filled} entries -> {po_p}")
for u in unknown:
    print("  UNUSED key:", u[:100])
