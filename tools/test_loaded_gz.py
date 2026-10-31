"""端到端验证「压缩注释/序列文件」的导入路径。

覆盖 LoadedManager.add() 对 .gtf.gz / .bed.gz / .fa.gz 的识别、落盘扩展名、
格式回传，以及同一内容二次导入时 GTF pickle 缓存的命中速度。

用法（在 igv_0.2 目录下）：
    python tools/test_loaded_gz.py
"""
from __future__ import annotations

import gzip
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from igvlocal.loaded import LoadedManager  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix="igv_gz_"))
SLICE = Path(os.environ.get("TEMP", "/tmp")) / "gtf_slice.gtf"

passed = failed = 0


def ck(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  OK  {name}{('  ' + extra) if extra else ''}")
    else:
        failed += 1
        print(f"  !!  {name}{('  ' + extra) if extra else ''}")


def main() -> int:
    print(f"临时目录：{TMP}")

    # ---------- 1. GTF.gz -------------------------------------------------
    print("\n[1] GTF.gz 导入")
    src = TMP / "upload.gtf.gz"          # 模拟 server 的上传临时文件
    with open(SLICE, "rb") as fi, gzip.open(src, "wb", compresslevel=6) as fo:
        shutil.copyfileobj(fi, fo, 1 << 20)
    up = TMP / "_upload_1.tmp"
    shutil.copyfile(src, up)

    mgr = LoadedManager(TMP / "data")
    t0 = time.perf_counter()
    t = mgr.add(up, "Homo_sapiens.GRCh38.112.gtf.gz")
    t_parse = time.perf_counter() - t0
    ck("track 是 GtfTrack", type(t).__name__ == "GtfTrack", type(t).__name__)
    ck("format == gtf", t.format == "gtf", t.format)
    ck("id 去掉 .gz 后缀", t.id == "Homo_sapiens.GRCh38.112", t.id)
    ck("落盘保留 .gtf.gz", t.path.name.endswith(".gtf.gz"), t.path.name)
    ck("上传临时文件已被移走", not up.exists())
    ck("基因数正确", len(t._genes) == 17533, str(len(t._genes)))
    print(f"      首次解析 {t_parse:.2f} s")

    # ---------- 2. 同一内容二次导入 -> 命中缓存 ---------------------------
    print("\n[2] 同一 GTF.gz 二次导入（内容指纹缓存）")
    up2 = TMP / "_upload_2.tmp"
    shutil.copyfile(src, up2)
    t0 = time.perf_counter()
    t2 = mgr.add(up2, "Homo_sapiens.GRCh38.112.gtf.gz")
    t_cached = time.perf_counter() - t0
    ck("生成了不同的 id", t2.id != t.id, f"{t.id} / {t2.id}")
    ck("命中缓存后明显更快", t_cached < t_parse / 2,
       f"{t_cached:.2f} s vs {t_parse:.2f} s")
    ck("基因数一致", len(t2._genes) == len(t._genes))
    caches = list((TMP / "data" / "loaded" / ".cache").glob("*.gtf.pkl"))
    ck("只留一份缓存（同一内容）", len(caches) == 1, f"{len(caches)} 个")

    # ---------- 3. BED.gz -------------------------------------------------
    print("\n[3] BED.gz / narrowPeak.gz")
    bed = TMP / "_upload_3.tmp"
    with gzip.open(bed, "wt", encoding="utf-8") as f:
        f.write("track name=peaks\n")
        f.write("chr1\t1000\t1200\tpeakA\t0\t+\n")
        f.write("chr1\t5000\t5100\tpeakB\t0\t-\n")
    tb = mgr.add(bed, "peaks.bed.gz")
    ck("format == bed", tb.format == "bed", tb.format)
    ck("落盘保留 .bed.gz", tb.path.name.endswith(".bed.gz"), tb.path.name)
    ck("区间数 == 2", tb.n == 2, str(tb.n))
    ck("query 命中 chr1:900-1300", len(tb.query("chr1", 900, 1300)) == 1)

    np_ = TMP / "_upload_4.tmp"
    with gzip.open(np_, "wt", encoding="utf-8") as f:
        f.write("chr1\t2000\t2100\tp1\t50\t.\t7.5\t3.2\t1.1\t20\n")
    tn = mgr.add(np_, "sample.narrowPeak.gz")
    ck("format == narrowpeak（.gz 不吃掉后缀）", tn.format == "narrowpeak", tn.format)
    ck("落盘保留 .narrowpeak.gz", tn.path.name.endswith(".narrowpeak.gz"), tn.path.name)

    # ---------- 4. FASTA.gz ----------------------------------------------
    print("\n[4] FASTA.gz")
    fa = TMP / "_upload_5.tmp"
    seq = "ACGT" * 250          # 1000 bp
    with gzip.open(fa, "wt", encoding="utf-8") as f:
        f.write(">chr1 test sequence\n")
        for i in range(0, len(seq), 60):
            f.write(seq[i:i + 60] + "\n")
    tf = mgr.add(fa, "tiny.fa.gz")
    ck("format == fasta", tf.format == "fasta", tf.format)
    ck("长度 == 1000", tf.chroms.get("chr1") == 1000, str(tf.chroms.get("chr1")))
    ck("fetch 0-10", tf.fetch("chr1", 0, 10) == "ACGTACGTAC", tf.fetch("chr1", 0, 10))
    ck("fetch 跨行 55-70", tf.fetch("chr1", 55, 70) == ("ACGT" * 250)[55:70],
       tf.fetch("chr1", 55, 70))
    ck("fetch 末尾 995-1000", tf.fetch("chr1", 995, 1000) == seq[995:1000],
       tf.fetch("chr1", 995, 1000))

    # ---------- 5. 不支持的扩展名 ----------------------------------------
    print("\n[5] 不支持的扩展名")
    bad = TMP / "_upload_6.tmp"
    bad.write_text("hello")
    try:
        mgr.add(bad, "notes.txt")
        ck("应抛出 ValueError", False)
    except ValueError as e:
        ck("抛出 ValueError", True, str(e))

    # ---------- 6. 移除轨道要连缓存一起删 --------------------------------
    print("\n[6] remove() 清理 pickle 缓存")
    cp = t2.cache_path()
    ck("缓存文件存在", cp.exists(), cp.name)
    ck("remove 返回 True", mgr.remove(t2.id) is True)
    ck("源文件已删除", not t2.path.exists())
    ck("缓存文件已删除", not cp.exists(), cp.name)

    print(f"\n结果：{passed} 通过 / {failed} 失败")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
