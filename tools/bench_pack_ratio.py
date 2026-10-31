"""评估用：实测各部分的 LZMA2 压缩率（近似 Inno Setup 的 lzma2/ultra）。

只读几个采样块，不写任何产物。
"""
from __future__ import annotations

import io
import lzma
import os
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MB = 1024 * 1024
FILT = [{"id": lzma.FILTER_LZMA2, "preset": 9}]


def ratio(name: str, data: bytes) -> tuple[str, int, int]:
    out = lzma.compress(data, format=lzma.FORMAT_XZ, filters=FILT)
    return name, len(data), len(out)


def sample_2bit(path: Path, span: int = 16 * MB) -> tuple[str, int, int]:
    size = path.stat().st_size
    # 取中段：避开文件头部那一大片全 0 的 N 掩码块，压缩率才真实
    off = (size // 2) - span // 2
    with path.open("rb") as f:
        f.seek(off)
        data = f.read(span)
    return ratio(path.name + " (中段 16 MB)", data)


def dir_tar(path: Path) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        tf.add(path, arcname=path.name)
    return buf.getvalue()


def main() -> None:
    rows = []
    for db in ("hg38", "mm10"):
        p = ROOT / "data" / "genomes" / f"{db}.2bit"
        if p.exists():
            rows.append(sample_2bit(p))

    ann = ROOT / "data" / "ann" / "hg38" / "genes.igvbin"
    if ann.exists():
        rows.append(ratio("genes.igvbin (hg38, 全量)", ann.read_bytes()))

    internal = ROOT / "dist" / "Orbit" / "_internal"
    if internal.exists():
        rows.append(ratio("_internal/ (tar)", dir_tar(internal)))

    exe = ROOT / "dist" / "Orbit" / "Orbit.exe"
    if exe.exists():
        rows.append(ratio("Orbit.exe", exe.read_bytes()))

    print(f"{'部分':34s} {'原始':>10s} {'压缩后':>10s} {'比率':>7s}")
    print("-" * 66)
    for name, a, b in rows:
        print(f"{name:34s} {a/MB:9.1f}M {b/MB:9.1f}M {b/a*100:6.1f}%")


if __name__ == "__main__":
    main()
