"""用最新生成的 .pot 重排某个 .po：保留已有译文，缺失的按 NEW 字典补上。

用法：python tools/merge_po.py <pot> <po> [--write]
不加 --write 只打印差异，便于先看一眼。
"""
import ast
import io
import re
import sys
from pathlib import Path

ENTRY_SPLIT = re.compile(r"\n\n+")


def parse_po(text):
    """返回 [(msgid, msgstr)]，按文件顺序；忽略注释头。"""
    out = []
    cur_id, cur_str, mode = None, None, None
    buf = []

    def flush_buf():
        nonlocal buf
        if mode is None:
            buf = []
            return None
        val = "".join(buf)
        buf = []
        return val

    for raw in text.splitlines():
        line = raw.rstrip("\n")
        if line.startswith("#") or line.strip() == "":
            continue
        if line.startswith("msgid "):
            cur_id = ast.literal_eval(line[6:].strip())
            mode = "id"
        elif line.startswith("msgstr "):
            cur_str = ast.literal_eval(line[7:].strip())
            mode = "str"
        elif line.startswith('"'):
            piece = ast.literal_eval(line.strip())
            if mode == "id":
                cur_id += piece
            elif mode == "str":
                cur_str += piece
        if line.startswith("msgstr ") or (line.startswith('"') and mode == "str"):
            # 遇到下一条 msgid 之前把整条收好
            pass
        # 收尾：下一行是 msgid 时提交上一条
        if line.startswith("msgid ") and cur_str is not None:
            out.append((cur_id_prev, cur_str))
            cur_str = None
        if line.startswith("msgid "):
            cur_id_prev = cur_id
    if cur_str is not None:
        out.append((cur_id_prev, cur_str))
    return out


def parse_simple(text):
    """更稳的解析：先切成条目块，再逐块读 msgid/msgstr。"""
    entries = []
    blocks = re.split(r"\n\s*\n", text)
    for blk in blocks:
        lines = [l for l in blk.splitlines() if l.strip() and not l.startswith("#")]
        if not lines:
            continue
        mid = mstr = None
        target = None
        for l in lines:
            if l.startswith("msgid "):
                target = "id"
                piece = ast.literal_eval(l[6:].strip())
                mid = piece if mid is None else mid + piece
            elif l.startswith("msgstr "):
                target = "str"
                piece = ast.literal_eval(l[7:].strip())
                mstr = piece if mstr is None else mstr + piece
            elif l.startswith('"'):
                piece = ast.literal_eval(l.strip())
                if target == "id":
                    mid = (mid or "") + piece
                elif target == "str":
                    mstr = (mstr or "") + piece
        if mid is not None:
            entries.append((mid, mstr or ""))
    return entries


def esc(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def main():
    pot_p, po_p = Path(sys.argv[1]), Path(sys.argv[2])
    write = "--write" in sys.argv
    new_entries = parse_simple(pot_p.read_text(encoding="utf-8"))
    old = dict(parse_simple(po_p.read_text(encoding="utf-8"))) if po_p.exists() else {}

    header = ('msgid ""\nmsgstr ""\n'
              '"Project-Id-Version: Orbit\\n"\n'
              '"Language: zh_CN\\n"\n'
              '"MIME-Version: 1.0\\n"\n'
              '"Content-Type: text/plain; charset=UTF-8\\n"\n'
              '"Content-Transfer-Encoding: 8bit\\n"\n'
              '"Plural-Forms: nplurals=1; plural=0;\\n"\n')

    lines = [header]
    missing = []
    for mid, _ in new_entries:
        tr = old.get(mid, "")
        if not tr:
            missing.append(mid)
        lines.append("msgid " + esc(mid))
        lines.append("msgstr " + esc(tr))
        lines.append("")
    text = "\n".join(lines)
    print(f"{len(new_entries)} entries, {len(missing)} untranslated")
    for m in missing:
        print("  MISSING:", m[:110].replace("\n", " "))
    if write:
        po_p.write_text(text, encoding="utf-8")
        print("written", po_p)


main()
