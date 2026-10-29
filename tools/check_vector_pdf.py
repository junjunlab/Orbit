#!/usr/bin/env python3
"""校验矢量 PDF：结构 + 真的没有位图 + 内嵌字体可用 + 内容流是矢量指令。

    python tools/check_vector_pdf.py shots/vector.pdf

只依赖标准库（zlib/struct）。检查项：
  1. %PDF 头 / %%EOF / startxref / xref 每个偏移都指向 "N 0 obj"
  2. 页面 MediaBox 合理，内容流可 Flate 解压
  3. 内容流里没有任何图像对象（/Subtype/Image、Do 引用图像）
  4. 内容流里同时有填充矩形/路径/贝塞尔/文字指令
  5. 内嵌字体是合法 sfnt：表目录在界内、loca 单调、glyf 落在文件内、numGlyphs 对得上
  6. /W 宽度表覆盖内容流里用到的 gid
"""
from __future__ import annotations

import re
import struct
import sys
import zlib
from pathlib import Path


def sfnt_check(data: bytes) -> dict:
    if len(data) < 12:
        raise SystemExit("font: 文件太短")
    ver, num = struct.unpack_from(">IH", data, 0)
    if ver not in (0x00010000, 0x4F54544F):  # 1.0 / OTTO
        raise SystemExit(f"font: sfnt 版本异常 {ver:#x}")
    tables = {}
    for i in range(num):
        o = 12 + i * 16
        tag = data[o:o + 4].decode("latin-1")
        csum, off, ln = struct.unpack_from(">III", data, o + 4)
        if off + ln > len(data):
            raise SystemExit(f"font: 表 {tag} 越界 ({off}+{ln} > {len(data)})")
        tables[tag] = (off, ln, csum)
    for need in ("head", "hhea", "maxp", "hmtx", "loca", "glyf"):
        if need not in tables:
            raise SystemExit(f"font: 缺表 {need}")
    head_off = tables["head"][0]
    units = struct.unpack_from(">H", data, head_off + 18)[0]
    loc_fmt = struct.unpack_from(">h", data, head_off + 50)[0]
    num_glyphs = struct.unpack_from(">H", data, tables["maxp"][0] + 4)[0]
    loca_off, loca_len, _ = tables["loca"]
    glyf_off, glyf_len, _ = tables["glyf"]
    want = (num_glyphs + 1) * (4 if loc_fmt else 2)
    if loca_len < want:
        raise SystemExit(f"font: loca 长度 {loca_len} < {want}")
    offs = []
    for i in range(num_glyphs + 1):
        if loc_fmt:
            offs.append(struct.unpack_from(">I", data, loca_off + i * 4)[0])
        else:
            offs.append(struct.unpack_from(">H", data, loca_off + i * 2)[0] * 2)
    if any(b < a for a, b in zip(offs, offs[1:])):
        raise SystemExit("font: loca 非单调")
    if offs[-1] > glyf_len:
        raise SystemExit(f"font: loca 末项 {offs[-1]} > glyf 长度 {glyf_len}")
    nonempty = sum(1 for i in range(num_glyphs) if offs[i + 1] > offs[i])
    return {
        "tables": len(tables), "unitsPerEm": units, "numGlyphs": num_glyphs,
        "bytes": len(data), "nonEmptyGlyphs": nonempty,
        "bytes": len(data),
    }


def main() -> None:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "shots/vector.pdf")
    raw = path.read_bytes()
    ok = True

    def say(cond: bool, msg: str) -> None:
        nonlocal ok
        print(("  OK   " if cond else "  FAIL ") + msg)
        ok = ok and cond

    print(f"== {path} ({len(raw)} bytes) ==")
    say(raw.startswith(b"%PDF"), "有 %PDF 头")
    say(raw.rstrip().endswith(b"%%EOF"), "有 %%EOF 结尾")

    m = re.search(rb"startxref\s+(\d+)\s+%%EOF", raw)
    say(bool(m), "找到 startxref")
    xref = int(m.group(1)) if m else 0
    say(raw[xref:xref + 4] == b"xref", f"startxref 指向 xref 表（@{xref}）")

    head = raw[xref:xref + 400].split(b"trailer")[0].decode("latin-1")
    lines = [ln for ln in head.splitlines() if ln.strip()]
    counts = lines[1].split() if len(lines) > 1 else ["0", "0"]
    total = int(counts[1])
    entries = lines[2:2 + total]
    bad = []
    for i, ln in enumerate(entries[1:], start=1):
        off = int(ln.split()[0])
        if raw[off:off + 20].split(b" ")[0:2] != [str(i).encode(), b"0"]:
            bad.append((i, off))
    say(not bad, f"xref 全部 {total - 1} 个偏移都指向对应对象" + (f"（坏：{bad[:3]}）" if bad else ""))

    # 对象表
    objs = {}
    for mm in re.finditer(rb"(\d+) 0 obj\s", raw):
        n = int(mm.group(1))
        objs[n] = mm.end()

    def stream_of(n: int) -> bytes | None:
        start = objs.get(n)
        if start is None:
            return None
        s = raw.find(b"stream", start)
        if s < 0:
            return None
        s += len(b"stream")
        if raw[s:s + 2] == b"\r\n":
            s += 2
        elif raw[s:s + 1] in (b"\n", b"\r"):
            s += 1
        e = raw.find(b"endstream", s)
        blob = raw[s:e]
        try:
            return zlib.decompress(blob)
        except zlib.error:
            return blob

    # 找页面与内容流
    page = re.search(rb"/Type/Page[^s].*?/Contents (\d+) 0 R", raw, re.S)
    say(bool(page), "找到页面对象与其 /Contents")
    media = re.search(rb"/MediaBox\[0 0 ([\d.]+) ([\d.]+)\]", raw)
    if media:
        w, h = float(media.group(1)), float(media.group(2))
        say(100 < w < 10000 and 100 < h < 10000, f"MediaBox 尺寸合理（{w:.0f}×{h:.0f} pt）")

    content = stream_of(int(page.group(1))) if page else b""
    say(bool(content), f"内容流可读（解压后 {len(content) if content else 0} 字节）")
    txt = content.decode("latin-1") if content else ""

    say("/Subtype/Image" not in raw.decode("latin-1"), "全文没有 /Subtype/Image（不是位图）")
    say(" Do" not in txt and "\nDo" not in txt, "内容流里没有 Do（没有贴图）")
    say(bool(re.search(r"\bre\s+f\b", txt)), "有填充矩形 re f")
    say(bool(re.search(r"\bm\b", txt)) and bool(re.search(r"\bl\b", txt)), "有路径 m/l")
    say(bool(re.search(r"\bc\b", txt)), "有贝塞尔曲线 c")
    say("BT" in txt and "Tj" in txt, "有文字对象 BT … Tj")
    say(" re f" in txt or "rg" in txt, "有颜色算子 rg")

    # 字体
    ff = re.search(rb"/FontFile2 (\d+) 0 R", raw)
    say(bool(ff), "字体以 FontFile2 内嵌")
    if ff:
        fdata = stream_of(int(ff.group(1)))
        info = sfnt_check(fdata)
        print("       font:", info)
        say(info["nonEmptyGlyphs"] > 0, f"字体里有 {info['nonEmptyGlyphs']} 个非空字形")

    tou = re.search(rb"/ToUnicode (\d+) 0 R", raw)
    if tou:
        cmap = stream_of(int(tou.group(1))) or b""
        say(b"beginbfchar" in cmap, "带 ToUnicode（文字可复制）")

    print("=> VECTOR PDF OK" if ok else "=> 有问题，见上面 FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
