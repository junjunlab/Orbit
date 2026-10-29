"""解析回收站 $I 元数据（原始路径 / 删除时间 / 大小），只读。

$I 格式（Win10）：VER(8) SIZE(8) FILETIME(8) [VER2: 4 字节名字长度] 原路径(UTF-16LE)
"""

from __future__ import annotations

import datetime as dt
import struct
from pathlib import Path

ROOT = Path("C:/$Recycle.Bin")
IGV = "agent_devop_pkgs\\igv"


def parse_index(path: Path) -> dict | None:
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if len(raw) < 24:
        return None
    ver, size, ft = struct.unpack("<QQQ", raw[:24])
    off = 24
    if ver == 2 and len(raw) >= 28:
        off = 28
    name = raw[off:].decode("utf-16-le", errors="replace").split("\x00")[0]
    if not name:
        name = raw[24:].decode("utf-16-le", errors="replace").split("\x00")[0]
    try:
        when = dt.datetime(1601, 1, 1) + dt.timedelta(microseconds=ft // 10)
        when = when + dt.timedelta(hours=8)
    except OverflowError:
        when = None
    return {"ver": ver, "size": size, "when": when, "orig": name}


def main() -> None:
    rows = []
    for sid_dir in ROOT.iterdir():
        if not sid_dir.is_dir():
            continue
        try:
            entries = list(sid_dir.iterdir())
        except OSError:
            continue
        for f in entries:
            if not f.name.startswith("$I"):
                continue
            info = parse_index(f)
            if not info:
                continue
            info["pair"] = sid_dir / ("$R" + f.name[2:])
            info["sid"] = sid_dir.name
            rows.append(info)

    rows.sort(key=lambda r: -r["size"])
    print(f"回收站条目：{len(rows)}，合计 {sum(r['size'] for r in rows) / 1e9:.2f} GB\n")
    for r in rows:
        if r["size"] < 500_000_000:
            continue
        flag = "IGV" if IGV.lower() in r["orig"].lower() else "   "
        ex = "存在" if r["pair"].exists() else "缺失"
        print(f"[{flag}] {r['size'] / 1e9:6.2f} GB {ex}  {r['when']:%Y-%m-%d %H:%M}  {r['orig']}")


if __name__ == "__main__":
    main()
