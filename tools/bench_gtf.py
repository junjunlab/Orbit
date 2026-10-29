"""GTF 解析基准：比对优化前后耗时 / 结果，并验证 .gz 支持。

用法（在 igv_0.2 目录下）：
    python tools/bench_gtf.py [slice.gtf]

slice.gtf 缺省用 %TEMP%/gtf_slice.gtf（真实 GRCh38 GTF 的前 100 万行）。
"""
from __future__ import annotations

import gzip
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from igvlocal.loaded import GtfTrack, _open_text, _split_ext  # noqa: E402

SLICE = Path(sys.argv[1] if len(sys.argv) > 1 else
             Path(os.environ.get("TEMP", "/tmp")) / "gtf_slice.gtf")

EXPECT = (17533, 71956)          # 旧实现的输出（基因 / 转录本），用于回归比对


def parse_direct(path: Path):
    """绕过 pickle 缓存，直接跑 _parse()。"""
    t = GtfTrack.__new__(GtfTrack)
    t.id = "bench"
    t.name = path.name
    t.path = path
    t.format = "gtf"
    t.chroms = {}
    t.total = None
    t._alias = None
    t0 = time.perf_counter()
    genes = t._parse()
    dt = time.perf_counter() - t0
    return genes, dt, len(genes), sum(len(g.transcripts) for g in genes)


def main() -> int:
    if not SLICE.exists():
        print(f"找不到测试文件：{SLICE}")
        return 2
    size = SLICE.stat().st_size
    with open(SLICE, "rb") as f:
        nlines = sum(1 for _ in f)
    print(f"输入：{SLICE.name}  {size / 1e6:.0f} MB  {nlines:,} 行\n")

    ok = True

    # ---- 1. 纯文本 -------------------------------------------------------
    g_plain, dt, ng, nt = parse_direct(SLICE)
    print(f"[plain]  {dt:6.2f} s   {ng:,} 基因 / {nt:,} 转录本")
    if (ng, nt) != EXPECT:
        print(f"  !! 结果与旧实现不一致，期望 {EXPECT}")
        ok = False
    else:
        print(f"  OK 与旧实现一致 {EXPECT}")

    # ---- 2. gzip 压缩版 --------------------------------------------------
    gz = SLICE.parent / (SLICE.name + ".gz")
    if not gz.exists():
        t0 = time.perf_counter()
        with open(SLICE, "rb") as fi, gzip.open(gz, "wb", compresslevel=6) as fo:
            while True:
                b = fi.read(1 << 20)
                if not b:
                    break
                fo.write(b)
        print(f"[gz]     压缩完成 {gz.stat().st_size / 1e6:.0f} MB "
              f"({time.perf_counter() - t0:.1f} s) -> {gz.name}")
    g_gz, dtgz, ngz, ntz = parse_direct(gz)
    print(f"[gz]     {dtgz:6.2f} s   {ngz:,} 基因 / {ntz:,} 转录本")
    if (ngz, ntz) != (ng, nt):
        print("  !! .gz 解析结果与纯文本不一致")
        ok = False
    # Gene 是 __slots__ 类、没定义 __eq__（== 是身份比较），所以比对 to_dict()
    same = [g.to_dict() for g in g_gz] == [g.to_dict() for g in g_plain]
    print(f"  {'OK' if same else '!!'} 与纯文本逐字段一致：{same}")
    ok = ok and same

    # ---- 3. 扩展名识别 ---------------------------------------------------
    for nm, want in (("a.gtf", ("gtf", ".gtf")),
                     ("a.gtf.gz", ("gtf", ".gtf.gz")),
                     ("a.GFF3.GZ", ("gtf", ".gff3.gz")),
                     ("a.narrowPeak.gz", ("narrowpeak", ".narrowpeak.gz")),
                     ("a.bed.bgz", ("bed", ".bed.bgz")),
                     ("a.txt", (None, ".txt"))):
        got = _split_ext(nm)
        mark = "OK " if got == want else "!! "
        if got != want:
            ok = False
        print(f"[ext]    {mark}{nm:18s} -> {got}")

    # ---- 4. _open_text 魔数嗅探 -----------------------------------------
    with _open_text(gz) as f:
        first_gz = f.readline()
    with _open_text(SLICE) as f:
        first_plain = f.readline()
    same = first_gz == first_plain
    print(f"[open]   {'OK ' if same else '!! '}魔数嗅探：.gz 与纯文本首行一致 = {same}")
    ok = ok and same

    print("\n结论：" + ("全部通过" if ok else "有失败项"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
