"""Verify a Windows exe embeds the exact icon images from a .ico file.

Compares the RT_ICON resource payloads inside the exe against the image
payloads stored in the .ico, so a PyInstaller default icon cannot pass.
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path


def ico_images(path: Path) -> list[bytes]:
    """Return the raw image payloads stored in an .ico file."""
    d = path.read_bytes()
    reserved, typ, count = struct.unpack_from("<HHH", d, 0)
    assert reserved == 0 and typ == 1, "not an icon file"
    out = []
    for i in range(count):
        off = 6 + i * 16
        w, h, colors, rsv, planes, bpp, size, data_off = struct.unpack_from("<BBBBHHII", d, off)
        out.append(d[data_off:data_off + size])
    return out


def _rva_to_off(sections, rva):
    for va, vsize, raw_off, raw_size in sections:
        if va <= rva < va + max(vsize, raw_size):
            return raw_off + (rva - va)
    raise ValueError("rva not in any section")


def _walk(dir_off, data, base, depth, out, want_type=None):
    n_named, n_id = struct.unpack_from("<HH", data, dir_off + 12)
    entry = dir_off + 16
    for i in range(n_named + n_id):
        name, offset = struct.unpack_from("<II", data, entry + i * 8)
        is_dir = bool(offset & 0x80000000)
        val = offset & 0x7FFFFFFF
        if depth == 0:
            if is_dir:
                _walk(base + val, data, base, 1, out)
        elif depth == 1:
            if is_dir:
                _walk(base + val, data, base, 2, out)
        else:
            if not is_dir:
                rva, size = struct.unpack_from("<II", data, base + val)
                out.append((name, rva, size))


def exe_icon_payloads(exe: Path) -> list[bytes]:
    d = exe.read_bytes()
    e_lfanew = struct.unpack_from("<I", d, 0x3C)[0]
    assert d[e_lfanew:e_lfanew + 4] == b"PE\0\0"
    coff = e_lfanew + 4
    n_sections = struct.unpack_from("<H", d, coff + 2)[0]
    opt_size = struct.unpack_from("<H", d, coff + 16)[0]
    opt = coff + 20
    magic = struct.unpack_from("<H", d, opt)[0]
    dd_off = opt + (112 if magic == 0x20B else 96)
    rsrc_rva, rsrc_size = struct.unpack_from("<II", d, dd_off + 2 * 8)  # data dir index 2
    sec = opt + opt_size
    sections = []
    for i in range(n_sections):
        s = sec + i * 40
        va, vsize = struct.unpack_from("<II", d, s + 12)
        raw_size, raw_off = struct.unpack_from("<II", d, s + 16)
        sections.append((va, vsize, raw_off, raw_size))
    base = _rva_to_off(sections, rsrc_rva)

    # level 1 = resource types; collect the RT_ICON (3) subtree.
    n_named, n_id = struct.unpack_from("<HH", d, base + 12)
    icon_dir = None
    for i in range(n_named + n_id):
        name, offset = struct.unpack_from("<II", d, base + 16 + i * 8)
        if not (offset & 0x80000000) or name != 3:
            continue
        icon_dir = base + (offset & 0x7FFFFFFF)
        break
    if icon_dir is None:
        return []
    leaves = []
    _walk(icon_dir, d, base, 1, leaves)
    payloads = []
    for _name, rva, size in leaves:
        off = _rva_to_off(sections, rva)
        payloads.append(d[off:off + size])
    return payloads


def main() -> int:
    ico = Path(sys.argv[1])
    exe = Path(sys.argv[2])
    want = ico_images(ico)
    have = exe_icon_payloads(exe)
    print(f"ico images: {len(want)}  exe RT_ICON payloads: {len(have)}")
    want_set = {hashlib_sha(p): p for p in want}
    matched = 0
    for p in have:
        if hashlib_sha(p) in want_set:
            matched += 1
    print(f"exact matches: {matched}/{len(want)} of the .ico images found in exe")
    ok = matched >= min(len(want), len(have)) and matched > 0
    print("RESULT", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def hashlib_sha(b: bytes) -> str:
    import hashlib
    return hashlib.sha1(b).hexdigest()


if __name__ == "__main__":
    sys.exit(main())
