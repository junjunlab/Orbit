"""User-loaded tracks: bigWig / bedGraph / BAM / GTF / FASTA.

These are the common IGV file types that are not part of the bundled build.
仅使用 Python 标准库；BAM 通过 BGZF 块读取，并利用可用 BAI 索引按窗口查询。

Every track exposes one of three interfaces:

* signal -> ``summary(chrom, start, end, bins)`` -> ``[{ "m":.., "x":.. } | None]``
* gene   -> ``query(chrom, start, end)``          -> ``[Gene, ...]``
* seq    -> ``fetch(chrom, start, end)``          -> ``str | None``

Imported files live under ``data/loaded/`` and are re-registered from
``index.json`` on startup.
"""
from __future__ import annotations

import bisect
import gzip
import hashlib
import io
import json
import os
import pickle
import re
import shutil
import statistics
import struct
import sys
import threading
import zlib
from array import array
from pathlib import Path

from .annbin import Gene
from .bigwig import BigWig, BigWigError

# extension -> format
FORMAT_BY_EXT = {
    ".bw": "bigwig", ".bigwig": "bigwig",
    ".bedgraph": "bedgraph", ".bdg": "bedgraph",
    # wiggle：variableStep / fixedStep，和 bedGraph 一样映射成区间+值
    ".wig": "wig", ".wiggle": "wig",
    ".bam": "bam",
    # SAM：未压缩的文本比对格式，解析后与 BAM 走同一套覆盖度/reads 视图
    ".sam": "sam",
    # SEG：拷贝数分段（GISTIC / TCGA / GDC 的 .seg）。一行 = 一个区间 + 平均 log2 拷贝数，
    # 走信号轨道那条渲染路径，但纵轴以 0 为中心、按正负分色（见 SegTrack）。
    ".seg": "seg",
    # 纯 .txt / .tsv 不写进这张表：它们没有固定含义，靠首行表头嗅探（_looks_like_seg），
    # 这样 xxx.seg.txt / xxx.seg.v2.txt / 任意名字的 SEG 表都能进。
    # .segtxt 只是早期版本留下的别名，留着不影响。
    ".segtxt": "seg",
    ".gtf": "gtf", ".gff": "gtf", ".gff3": "gtf",
    # 区间注释：BED 家族。narrowPeak/broadPeak 就是 BED6+4，解析逻辑完全一样，
    # 只是多出来的 signalValue/pValue/qValue/peak 列先不参与绘制。
    ".bed": "bed",
    ".narrowpeak": "narrowpeak",
    ".broadpeak": "broadpeak",
    ".fa": "fasta", ".fasta": "fasta", ".fna": "fasta", ".fas": "fasta",
}

# GTF/GFF 的 feature → 1=exon 2=CDS 3=gene（只贡献基因边界） 0=其它
# 用整数码代替字符串比较，热循环里省掉 300 万次 tuple 成员判断
_FEAT_CODE = {
    "exon": 1,
    "cds": 2, "start_codon": 2, "stop_codon": 2,
    "gene": 3, "pseudogene": 3,
}


# --------------------------------------------------------------------------- #
# interval helpers
# --------------------------------------------------------------------------- #
class _Intervals:
    """Sorted interval list for one chromosome with a bounded backward scan."""

    __slots__ = ("iv", "starts", "max_len")

    def __init__(self, iv):
        iv.sort(key=lambda t: t[0])
        self.iv = iv
        self.starts = [t[0] for t in iv]
        self.max_len = max((t[1] - t[0] for t in iv), default=1) or 1

    def overlapping(self, start, end):
        i = bisect.bisect_left(self.starts, end)
        floor = start - self.max_len
        j = i - 1
        out = []
        while j >= 0 and self.starts[j] >= floor:
            s, e = self.iv[j][0], self.iv[j][1]
            if e > start and s < end:
                out.append(self.iv[j])
            j -= 1
        out.reverse()
        return out

    def overlapping_idx(self, start, end):
        """同 overlapping，但返回下标（用于按文件偏移取回原始比对记录）。"""
        i = bisect.bisect_left(self.starts, end)
        floor = start - self.max_len
        j = i - 1
        out = []
        while j >= 0 and self.starts[j] >= floor:
            s, e = self.iv[j][0], self.iv[j][1]
            if e > start and s < end:
                out.append(j)
            j -= 1
        out.reverse()
        return out


def _bin_summary(ivs, start, end, bins):
    """value-weighted mean / max per bin (bedGraph semantics)."""
    if end <= start or bins <= 0:
        return []
    per = (end - start) / bins
    sums = [0.0] * bins
    wsum = [0.0] * bins
    maxs = [0.0] * bins
    for (s, e, v) in ivs:
        a = max(s, start)
        b = min(e, end)
        if b <= a:
            continue
        b0 = int((a - start) / per)
        b1 = int((b - start - 1e-9) / per)
        for bi in range(max(0, b0), min(bins - 1, b1) + 1):
            bs = max(a, start + bi * per)
            be = min(b, start + (bi + 1) * per)
            w = be - bs
            if w <= 0:
                continue
            sums[bi] += v * w
            wsum[bi] += w
            if v > maxs[bi]:
                maxs[bi] = v
    out = []
    for b in range(bins):
        if wsum[b] > 0:
            out.append({"m": round(sums[b] / wsum[b], 3), "x": round(maxs[b], 3)})
        else:
            out.append(None)
    return out


def _coverage_summary(ivs, start, end, bins):
    """Mean coverage depth per bin from read intervals [(s, e)]."""
    if end <= start or bins <= 0:
        return []
    per = (end - start) / bins
    cov = [0.0] * bins
    for (s, e) in ivs:
        a = max(s, start)
        b = min(e, end)
        if b <= a:
            continue
        b0 = int((a - start) / per)
        b1 = int((b - start - 1e-9) / per)
        for bi in range(max(0, b0), min(bins - 1, b1) + 1):
            bs = max(a, start + bi * per)
            be = min(b, start + (bi + 1) * per)
            if be > bs:
                cov[bi] += be - bs
    out = []
    for b in range(bins):
        m = cov[b] / per
        out.append({"m": round(m, 3), "x": round(m, 3)} if m > 0 else None)
    return out


def _safe_stem(name: str) -> str:
    base = Path(name).name
    low = base.lower()
    if low.endswith(".gz"):
        base = base[:-3]
    elif low.endswith(".bgz"):
        base = base[:-4]
    s = re.sub(r"[^\w.\-]+", "_", Path(base).stem).strip("._") or "track"
    return s[:60]


def _prune_cache(d: Path, keep: int) -> None:
    """GTF 解析缓存一份可能有上百 MB，只保留最近用到的几份。"""
    try:
        files = sorted(list(d.glob("*.gtf.pkl")) + list(d.glob("*.repeat.pkl")),
                       key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return
    for p in files[keep:]:
        try:
            p.unlink()
        except OSError:
            pass


def _quick_fingerprint(path: Path) -> str:
    """文件内容指纹 = 大小 + 首尾各 64 KB 的 sha1（毫秒级，不必读完整个文件）。

    用它而不是文件名/mtime 做缓存键：同一个 GTF 每导入一次都会被复制成新的
    ``<tid>.gtf``，mtime 也变了，只有内容不变 —— 而「每次启动都从零开始」的
    行为意味着用户会反复导入同一个文件，命中缓存就能把 20 s 的解析降到 1 s。
    """
    h = hashlib.sha1()
    st = path.stat()
    h.update(str(st.st_size).encode())
    with open(path, "rb") as f:
        h.update(f.read(65536))
        if st.st_size > 131072:
            f.seek(st.st_size - 65536)
            h.update(f.read(65536))
    return h.hexdigest()[:16]


# Ensembl/GENCODE name chromosomes ``1``/``X``/``MT`` while the bundled
# assemblies (and therefore the viewer's requests) use UCSC names
# ``chr1``/``chrX``/``chrM``.  A user-loaded file can be either flavour, so
# every lookup goes through an alias table instead of a raw dict hit.
def _chrom_variants(name: str):
    out = {name}
    low = name.lower()
    if low.startswith("chr"):
        base = name[3:]
        if base:
            out.add(base)
        if base.lower() in ("m", "mt"):
            out.update(("M", "MT", "chrM", "chrMT"))
    else:
        out.add("chr" + name)
        if low in ("m", "mt"):
            out.update(("M", "MT", "chrM", "chrMT"))
    return out


# --------------------------------------------------------------------------- #
# base
# --------------------------------------------------------------------------- #
class BaseTrack:
    kind = "signal"

    def __init__(self, tid: str, name: str, path: Path, fmt: str):
        self.id = tid
        self.name = name
        self.path = Path(path)
        self.format = fmt
        self.chroms: dict[str, int] = {}
        self.total = None
        self._alias: dict | None = None

    def resolve_chrom(self, chrom: str) -> str:
        """Return this track's own key for ``chrom`` (``chr8`` <-> ``8``)."""
        if chrom in self.chroms:
            return chrom
        amap = self._alias
        if amap is None:
            amap = {}
            for key in self.chroms:
                for v in _chrom_variants(key):
                    amap.setdefault(v, key)
            self._alias = amap
        return amap.get(chrom, chrom)

    def summary(self, chrom, start, end, bins):
        return []

    def meta(self) -> dict:
        return {
            "id": self.id, "name": self.name, "kind": self.kind, "format": self.format,
            "chroms": len(self.chroms),
            "probe": {c: self.chroms[c] for c in ("chr1", "chr2", "chrX") if c in self.chroms},
            "max": (self.total or {}).get("max") if isinstance(self.total, dict) else None,
        }


class BigWigSignal(BaseTrack):
    kind = "signal"

    def __init__(self, tid, name, path):
        super().__init__(tid, name, path, "bigwig")
        self.bw = BigWig(str(self.path))
        self.chroms = dict(self.bw.chroms)
        self.total = self.bw.total

    def summary(self, chrom, start, end, bins):
        return self.bw.summary(self.resolve_chrom(chrom), start, end, bins)


class BedGraphSignal(BaseTrack):
    kind = "signal"

    def __init__(self, tid, name, path):
        super().__init__(tid, name, path, "bedgraph")
        data: dict[str, list] = {}
        with _open_text(self.path) as f:
            for line in f:
                if not line or line[0] in "#tnb" and not line[0].isdigit():
                    # skips comments / track / browser lines cheaply
                    if line.startswith(("#", "track", "browser")) or not line.strip():
                        continue
                p = line.split()
                if len(p) < 4:
                    continue
                try:
                    s, e, v = int(p[1]), int(p[2]), float(p[3])
                except (ValueError, IndexError):
                    continue
                data.setdefault(p[0], []).append((s, e, v))
        _install_interval_signal(self, data)

    def summary(self, chrom, start, end, bins):
        it = self._iv.get(self.resolve_chrom(chrom))
        if it is None:
            return []
        return _bin_summary(it.overlapping(start, end), start, end, bins)


def _install_interval_signal(track, data):
    """整理 {chrom: [(s, e, v), ...]}，供 bedGraph / wig 共用。"""
    track._iv = {c: _Intervals(v) for c, v in data.items()}
    track.chroms = {c: max(e for _, e, _ in v) for c, v in data.items()}
    mx = max((v for arr in data.values() for _, _, v in arr), default=0.0)
    track.total = {"max": mx}


class WigSignal(BedGraphSignal):
    """WIG / wiggle signal.

    Handles all three shapes in the wild: ``variableStep``, ``fixedStep``, and
    the legacy bedGraph-like four-column body. Everything is normalised to
    intervals so binning and drawing are identical to bedGraph.
    """

    def __init__(self, tid, name, path):
        BaseTrack.__init__(self, tid, name, path, "wig")
        data: dict[str, list] = {}
        mode = None
        chrom = None
        start = step = span = 1
        with _open_text(self.path) as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith(("#", "track", "browser")):
                    continue
                if line.startswith("variableStep"):
                    mode, chrom, span = "var", None, 1
                    for kv in line.split()[1:]:
                        k, _, v = kv.partition("=")
                        try:
                            if k == "chrom":
                                chrom = v
                            elif k == "span":
                                span = max(1, int(v))
                        except ValueError:
                            pass
                    continue
                if line.startswith("fixedStep"):
                    mode, chrom, start, step, span = "fix", None, 1, 1, 1
                    for kv in line.split()[1:]:
                        k, _, v = kv.partition("=")
                        try:
                            if k == "chrom":
                                chrom = v
                            elif k == "start":
                                start = int(v)
                            elif k == "step":
                                step = max(1, int(v))
                            elif k == "span":
                                span = max(1, int(v))
                        except ValueError:
                            pass
                    continue
                if chrom is None:
                    continue
                p = line.split()
                try:
                    if mode == "fix":
                        v = float(p[0])
                        s = start - 1
                        data.setdefault(chrom, []).append((s, s + span, v))
                        start += step
                    elif mode == "var":
                        s = int(p[0]) - 1
                        data.setdefault(chrom, []).append((s, s + span, float(p[1])))
                    elif mode is None and len(p) >= 4:
                        # bare four-column body (some tools emit this)
                        data.setdefault(p[0], []).append(
                            (int(p[1]), int(p[2]), float(p[3])))
                except (ValueError, IndexError):
                    continue
        _install_interval_signal(self, data)


# ------------------------------------------------------------------- SEG
# 表头里各列的可能写法（统一转小写再比）。首列在 GDC 里叫 GDC_Aliquot_ID，
# 在 TCGA / GISTIC 里叫 Sample，也有直接叫 ID / Name 的 —— 所以按列名认，不按位置。
_SEG_COLS = {
    "sample": ("sample", "sample_id", "sampleid", "gdc_aliquot_id", "aliquot_id",
               "tumor_sample_barcode", "case_id", "id", "name"),
    "chrom": ("chromosome", "chrom", "chr", "contig"),
    "start": ("start", "start_position", "loc.start", "start_bp", "startpos"),
    "end": ("end", "end_position", "loc.end", "end_bp", "endpos"),
    "value": ("segment_mean", "seg.mean", "segmean", "segmentmean", "value",
              "log2_ratio", "log2ratio", "log2", "copy_number", "total_cn", "cn"),
}


def _seg_header_map(cells):
    """表头行 → {列名: 下标}；不像 SEG 表头就返回 None。"""
    low = [str(c).strip().lower().replace(" ", "_") for c in cells]
    m = {}
    for key, names in _SEG_COLS.items():
        for i, c in enumerate(low):
            if c in names:
                m[key] = i
                break
    if all(k in m for k in ("chrom", "start", "end", "value")):
        return m
    return None


def _looks_like_seg(path) -> bool:
    """扩展名不认识时（GDC 的 xxx.seg.v2.txt）按表头内容认一下。"""
    try:
        with _open_text(path) as f:
            for _ in range(30):
                line = f.readline()
                if not line:
                    break
                if not line.strip() or line[0] in "#;":
                    continue
                cells = line.rstrip("\r\n").split("\t") if "\t" in line else line.split(",")
                return _seg_header_map(cells) is not None
    except OSError:
        pass
    return False


class SegTrack(BedGraphSignal):
    """SEG：拷贝数分段文件（GISTIC / TCGA / GDC 的 .seg / .seg.txt）。

    一行 = 一个基因组区间 + 该区间的平均 log2 拷贝数，典型列：
    ``Sample  Chromosome  Start  End  Num_Probes  Segment_Mean``。
    渲染复用信号轨道那套（分箱取均值），区别只有两点：纵轴以 0 为中心对称、
    柱子按正负分色（增益红 / 缺失蓝），也就是 IGV 的 copy-number 画法。

    一个文件里可能塞了多个样本（GISTIC 的输入常见），这里先画第一个样本，
    样本清单留在 meta 里，之后要加「切换样本」不用再改解析。
    """

    kind = "signal"
    diverging = True          # 前端据此把纵轴做成以 0 为中心

    def __init__(self, tid, name, path):
        BaseTrack.__init__(self, tid, name, path, "seg")
        self.samples = []
        self.sample = None
        self.n_segments = 0
        self._by_sample = {}
        self._iv_cache = {}      # (样本, 染色体) -> _Intervals，热图逐行取数时复用
        self._parse()
        self._use(self.samples[0])

    def _parse(self):
        by: dict[str, dict[str, list]] = {}
        idx = None
        with _open_text(self.path) as f:
            for raw in f:
                line = raw.rstrip("\r\n")
                if not line.strip() or line[0] in "#;":
                    continue
                if "\t" in line:
                    cells = line.split("\t")
                elif line.count(",") >= 5:
                    cells = line.split(",")
                else:
                    cells = line.split()
                if idx is None:
                    m = _seg_header_map(cells)
                    if m is not None:
                        idx = m
                        continue
                    # 没有表头（纯 6 列数据）：按最常见的位置解析
                    idx = {"sample": 0, "chrom": 1, "start": 2, "end": 3, "value": 5}
                try:
                    chrom = cells[idx["chrom"]].strip()
                    s = int(float(cells[idx["start"]]))
                    e = int(float(cells[idx["end"]]))
                    v = float(cells[idx["value"]])
                except (ValueError, IndexError):
                    continue
                if not chrom or e <= s:
                    continue
                si = idx.get("sample")
                sid = cells[si].strip() if si is not None and si < len(cells) else ""
                by.setdefault(sid, {}).setdefault(chrom, []).append((s, e, v))
        if not by:
            raise ValueError("SEG 文件里没有可解析的数据行（需要 Chromosome/Start/End/Segment_Mean）")
        self._by_sample = by
        self.samples = list(by.keys())
        # 多样本时「区间数」按全部样本累计，热图轨道只有一条，报单样本的数会误导
        self.n_segments = sum(len(arr) for d in by.values() for arr in d.values())
        # 颜色定标用「整个文件」的 |Segment_Mean| 97 分位，而不是当前窗口的：
        # 1) IGV 的 CNV 热图缩放时颜色是稳定的，不跟着视野跳；
        # 2) 窗口分位数在放大后常常只有 0.3，会把整张图涂成深红深蓝。
        # 用 97 分位而不是 99：SEG 的长尾（同源缺失能到 log2 −30）会把 99 分位抬到 5 以上，
        # 那样整张图又变成一片惨白。
        mags = sorted(abs(v) for d in by.values() for arr in d.values() for (_, _, v) in arr)
        self.scale = (mags[min(len(mags) - 1, int(len(mags) * 0.97))] if mags else 0.5) or 0.5

    def _use(self, sid: str) -> None:
        self.sample = sid
        data = self._by_sample[sid]
        _install_interval_signal(self, data)
        # 全文件（含其它样本）的极值：纵轴和左侧色块都要用
        lo = hi = 0.0
        for d in self._by_sample.values():
            for arr in d.values():
                for _, _, v in arr:
                    if v < lo:
                        lo = v
                    elif v > hi:
                        hi = v
        self.total = {"max": hi, "min": lo}

    def meta(self) -> dict:
        m = super().meta()
        m["diverging"] = True
        m["min"] = (self.total or {}).get("min") if isinstance(self.total, dict) else None
        m["segments"] = self.n_segments
        m["scale"] = round(self.scale, 4)   # 整个文件的 |Segment_Mean| 99 分位，热图定标用
        m["samples"] = len(self.samples)
        m["sample"] = self.sample
        # 多个样本 → 前端画成热图：一行一个样本、一列一个 bin
        m["heatmap"] = len(self.samples) > 1
        if len(self.samples) > 1:
            m["sampleNames"] = list(self.samples)
            m["note"] = f"{len(self.samples)} 个样本"
        return m

    def matrix(self, chrom, start, end, bins):
        """样本 × bin 的均值矩阵（热图用）；没有数据的格子返回 None。"""
        key = self.resolve_chrom(chrom)
        rows = []
        for sid in self.samples:
            data = self._by_sample[sid].get(key)
            if not data:
                rows.append([None] * bins)
                continue
            # 缓存必须按 (样本, 染色体) 取：只按样本做 key 的话，先看过 chr1 再用 chr6
            # 就会拿 chr1 的区间去分 chr6 的箱，前半截是别的染色体的数据、后半截空白
            ck = (sid, key)
            iv = self._iv_cache.get(ck)
            if iv is None:
                iv = self._iv_cache[ck] = _Intervals(data)
            cells = _bin_summary(iv.overlapping(start, end), start, end, bins)
            rows.append([(c["m"] if c else None) for c in cells])
        return rows


# CIGAR op codes that consume the reference
_CIGAR_REF = {0, 2, 3, 7, 8}
_CIGAR_OPS = "MIDNSHP=X"
# 与 IGV 默认一致：不画未比对(0x4)、厂商质控失败(0x200)、重复(0x400)的 read。
# 注意 secondary(0x100)/supplementary(0x800) 不在其中 —— IGV 从不检查这两个
# flag（Java 版全仓无 isSecondaryAlignment 调用，igv.js 的 BamFilter 默认也
# 不过滤），所以这里同样保留。
_FLAG_IGV_HIDDEN = 0x4 | 0x200 | 0x400


def _passes_igv_defaults(flag: int) -> bool:
    return not (flag & _FLAG_IGV_HIDDEN)
# 预编译 struct：BAM 记录头固定 32 字节，前 16 字节含 refID/pos/name_len/mapq/bin/n_cigar/flag
_REC_HDR = struct.Struct("<iiBBHHH")
_I32 = struct.Struct("<i")
_U32 = struct.Struct("<I")
_EXPERIMENT_SAMPLE_READS = 1000
_EXPERIMENT_PROBE_BYTES = 8 * 1024 * 1024
_EXPERIMENT_PROBE_RECORDS = 10000


# 实验类型规则改编自 IGV src/main/java/org/igv/alignment/ReadStats.java。
# 本实现仅采样最多 1000 条 mapped，不实现 SBX 质量值推断。
# The MIT License (MIT)
# Copyright (c) 2007-2026 Broad Institute and Regents of the University of California
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.
class _ReadStats:
    """按 IGV ReadStats 判定实验类型；此采样不参与 reads 展示。"""

    def __init__(self):
        self.read_lengths = []
        self.cigar_lengths = []
        self.ref_to_read_ratios = []
        self.n_count = 0

    def add(self, read_length, ops):
        if len(self.read_lengths) >= _EXPERIMENT_SAMPLE_READS:
            return
        self.read_lengths.append(read_length)
        self.cigar_lengths.append(sum(len(str(length)) + 1 for length, _ in ops))
        if any(op == 3 for _, op in ops):
            self.n_count += 1
            if read_length > 0:
                self.ref_to_read_ratios.append(sum(n for n, op in ops if op in _CIGAR_REF) / read_length)

    def meta(self):
        n = len(self.read_lengths)
        median_length = statistics.median(self.read_lengths) if n else None
        stddev = statistics.stdev(self.read_lengths) if n > 1 else 0.0
        average_cigar = statistics.mean(self.cigar_lengths) if n else 0.0
        median_ratio = statistics.median(self.ref_to_read_ratios) if self.ref_to_read_ratios else 0.0
        fraction_ns = self.n_count / n if n else 0.0
        experiment = "unknown"
        if n >= 20:
            if median_ratio > 5 or fraction_ns > 0.01:
                experiment = "rna"
            elif (stddev > 100 or median_length > 1000) and average_cigar > 10:
                experiment = "third_gen"
            else:
                experiment = "other"
        return {"experimentType": experiment, "experimentSampled": n,
                "experimentStats": {"medianReadLength": median_length,
                                    "readLengthStdDev": stddev,
                                    "averageCigarLength": average_cigar,
                                    "medianRefToReadRatio": median_ratio,
                                    "fracReadsWithNs": fraction_ns}}


class _BgzfStream:
    """BGZF（分块 gzip）顺序读 + 按虚拟偏移随机定位。

    ``gzip.open`` 能读 BAM，但拿不到块偏移；而 BAM 想按区间取回原始比对记录，
    必须知道每条记录在压缩流里的位置。BAM 的虚拟偏移 = ``coffset << 16 | uoffset``
    （coffset 是文件内字节偏移，uoffset 是解压后块内偏移），
    按这个公式 seek 就能直接跳到任意一条记录 —— 这就是 htslib 的做法。
    """

    __slots__ = ("f", "buf", "pos", "buf_v", "next_coffset", "eof",
                 "_cache_coff", "_cache_size", "_cache_data")

    def __init__(self, path):
        self.f = open(path, "rb")
        self.buf = b""
        self.pos = 0
        self.buf_v = 0          # self.buf[0] 对应的虚拟偏移
        self.next_coffset = 0
        self.eof = False
        # 单块缓存：同一块里的相邻 read 反复 seek 时不必重复解压
        # （一个 BGZF 块约 64 KB、装 800 多条 read，命中率极高）
        self._cache_coff = -1
        self._cache_size = 0
        self._cache_data = b""

    # ---- 块级 ----------------------------------------------------------
    def _read_block(self):
        """读下一个 BGZF 块 -> (虚拟偏移, 解压数据)；到文件末尾返回 None。"""
        f = self.f
        coff = self.next_coffset
        if coff == self._cache_coff:
            self.next_coffset = coff + self._cache_size
            return coff << 16, self._cache_data
        f.seek(coff)
        head = f.read(12)
        if len(head) < 12:
            self.eof = True
            return None
        if head[:2] != b"\x1f\x8b" or not (head[3] & 4):
            raise ValueError("不是 BGZF/gzip 文件")
        xlen = struct.unpack("<H", head[10:12])[0]
        extra = f.read(xlen)
        bsize = None
        i = 0
        while i + 4 <= len(extra):
            si1, si2 = extra[i], extra[i + 1]
            slen = struct.unpack("<H", extra[i + 2:i + 4])[0]
            if si1 == 66 and si2 == 67 and slen == 2:      # "BC" 子字段 = BSIZE
                bsize = struct.unpack("<H", extra[i + 4:i + 6])[0] + 1
                break
            i += 4 + slen
        if bsize is None:
            raise ValueError("BGZF 块缺少 BSIZE 字段")
        rest = f.read(bsize - 12 - xlen)
        v = coff << 16
        self.next_coffset = coff + bsize
        data = zlib.decompress(rest, -15)
        self._cache_coff = coff
        self._cache_size = bsize
        self._cache_data = data
        return v, data

    def _next(self):
        b = self._read_block()
        if b is None:
            return False
        self.buf, self.pos, self.buf_v = b[1], 0, b[0]
        return True

    # ---- 字节流 --------------------------------------------------------
    def read(self, n):
        if not self.buf or self.pos >= len(self.buf):
            if not self._next():
                return b""
        avail = len(self.buf) - self.pos
        if avail >= n:
            out = self.buf[self.pos:self.pos + n]
            self.pos += n
            return out
        # 记录跨块：把剩余部分和新块拼起来（只在块边界发生，代价很小）
        parts = [self.buf[self.pos:]]
        need = n - avail
        self.pos = len(self.buf)
        while need > 0:
            if not self._next():
                break
            take = min(need, len(self.buf))
            parts.append(self.buf[:take])
            self.pos = take
            need -= take
        return b"".join(parts)

    def tell(self):
        # A virtual offset at a block boundary must point to the next compressed
        # block, not use a 65536-byte uncompressed offset (which overflows 16 bits).
        if self.pos >= len(self.buf):
            return self.next_coffset << 16
        return self.buf_v + self.pos

    def seek_virtual(self, v):
        coff = v >> 16
        self.next_coffset = coff
        self.eof = False
        if not self._next():
            raise ValueError("虚拟偏移超出文件范围")
        self.pos = v & 0xFFFF
        self.buf_v = coff << 16

    def read_record(self, v):
        """按虚拟偏移取回一条 BAM 记录（含 4 字节长度前缀之后的块体）。"""
        self.seek_virtual(v)
        hdr = self.read(4)
        if len(hdr) < 4:
            return None
        (bs,) = struct.unpack("<i", hdr)
        if bs <= 0:
            return None
        return self.read(bs)

    def close(self):
        try:
            self.f.close()
        except OSError:
            pass


_BASE16 = "=ACMGRSVTWYHKDBN"


def _decode_read(blk):
    """解一条 BAM 记录 -> {p,e,q,f,n,c,lseq,seq,ops,mm}（``p`` 为 0-based 起点）。"""
    if len(blk) < 32:
        return None
    (refID, pos, lrn, mapq, _bin, ncig, flag, lseq,
     _nref, _npos, _tlen) = struct.unpack_from("<iiBBHHHiiii", blk, 0)
    name = blk[32:32 + lrn - 1].decode("utf-8", "replace") if lrn > 1 else ""
    cig_off = 32 + lrn
    ops = []
    parts = []
    refend = pos
    for i in range(ncig):
        (c,) = struct.unpack_from("<I", blk, cig_off + i * 4)
        ln, op = c >> 4, c & 0xF
        ops.append((ln, op))
        if op in _CIGAR_REF:
            refend += ln
        parts.append(f"{ln}{_CIGAR_OPS[op]}")
    seq = ""
    if lseq > 0:
        so = cig_off + ncig * 4
        packed = blk[so:so + (lseq + 1) // 2]
        seq = "".join(
            _BASE16[(packed[i >> 1] >> (4 if not (i & 1) else 0)) & 0xF]
            for i in range(min(lseq, len(packed) * 2))
        )
    return {"p": pos, "e": refend, "q": mapq, "f": flag, "n": name,
            "c": "".join(parts), "lseq": lseq, "seq": seq, "ops": ops, "mm": []}


def _bam_aligned_blocks(blk):
    """仅 M/= /X 贡献覆盖度，N/D 只推进参考坐标。"""
    _, pos, lrn, _, _, ncig, _ = _REC_HDR.unpack_from(blk)
    for i in range(ncig):
        cv = _U32.unpack_from(blk, 32 + lrn + 4 * i)[0]
        op, length = cv & 15, cv >> 4
        if op in (0, 7, 8):
            yield pos, pos + length
        if op in _CIGAR_REF:
            pos += length


def _bam_aux_tags(blk, off):
    """解析 BAM aux 字段；损坏/未知字段跳过，不影响主记录。"""
    out = {}
    n = len(blk)
    while off + 3 <= n:
        tag = blk[off:off + 2].decode("ascii", "replace")
        typ = chr(blk[off + 2])
        off += 3
        try:
            if typ == "A":
                if off >= n: break
                out[tag] = chr(blk[off]); off += 1
            elif typ == "c":
                if off + 1 > n: break
                out[tag] = struct.unpack_from("<b", blk, off)[0]; off += 1
            elif typ == "C":
                if off + 1 > n: break
                out[tag] = blk[off]; off += 1
            elif typ == "s":
                if off + 2 > n: break
                out[tag] = struct.unpack_from("<h", blk, off)[0]; off += 2
            elif typ == "S":
                if off + 2 > n: break
                out[tag] = struct.unpack_from("<H", blk, off)[0]; off += 2
            elif typ == "i":
                if off + 4 > n: break
                out[tag] = struct.unpack_from("<i", blk, off)[0]; off += 4
            elif typ == "I":
                if off + 4 > n: break
                out[tag] = struct.unpack_from("<I", blk, off)[0]; off += 4
            elif typ == "f":
                if off + 4 > n: break
                out[tag] = struct.unpack_from("<f", blk, off)[0]; off += 4
            elif typ in ("Z", "H"):
                end = blk.find(b"\x00", off)
                if end < 0: break
                out[tag] = blk[off:end].decode("utf-8", "replace"); off = end + 1
            elif typ == "B":
                if off + 5 > n: break
                subtype = chr(blk[off]); count = struct.unpack_from("<i", blk, off + 1)[0]
                off += 5
                widths = {"c": 1, "C": 1, "s": 2, "S": 2, "i": 4, "I": 4, "f": 4}
                width = widths.get(subtype)
                if width is None or count < 0 or off + width * count > n: break
                vals = []
                fmts = {"c":"b", "C":"B", "s":"h", "S":"H", "i":"i", "I":"I", "f":"f"}
                fmt = fmts[subtype]
                for _ in range(count):
                    vals.append(struct.unpack_from("<" + fmt, blk, off)[0]); off += width
                out[tag] = vals
            else:
                break
        except (struct.error, UnicodeError):
            break
    return out

def _mismatches(rec, refseq, ref_start=None, clip=None):
    """返回相对 read 起点的错配偏移；参考序列可为整个查询窗口。"""
    out = []
    qi = 0
    ri = 0
    pos = rec["p"]
    if ref_start is None:
        ref_start = pos
    seq = rec["seq"].upper()
    rl = len(refseq)
    sl = len(seq)
    for ln, op in rec["ops"]:
        if op in (0, 7, 8):
            ref_i = pos + ri - ref_start
            lo = max(0, -ref_i)
            hi = min(ln, rl - ref_i, sl - qi)
            if clip is not None:
                lo = max(lo, clip[0] - pos - ri)
                hi = min(hi, clip[1] - pos - ri)
            for k in range(lo, hi):
                b = seq[qi + k]
                if b != refseq[ref_i + k].upper() and b != "N":
                    out.append([ri + k, b])
            qi += ln
            ri += ln
        elif op in (1, 4):      # I / S 只消耗 read
            qi += ln
        elif op in (2, 3):      # D / N 只消耗参考
            ri += ln
    return out


class BamSignal(BaseTrack):
    kind = "signal"
    def __init__(self, tid, name, path, max_reads: int | None = None, *, index_path=None):
        super().__init__(tid, name, path, "bam")
        self._index_override = Path(index_path) if index_path is not None else None
        self.index_error = None
        self._iv: dict[str, _Intervals] = {}
        # 每条比对记录在压缩流里的虚拟偏移，下标与 _iv[chrom] 一一对应
        self._voff: dict[str, array] = {}
        self.truncated = False
        self.n_reads = 0
        self.has_seq = False
        self.paired = False
        self._read_stats = _ReadStats()
        # 有 BAI 时按窗口读取；导入只解析头部并进行有界元信息采样。
        # 没有索引才退回整个文件顺序扫描，默认不限制导入记录数。
        self._chunks: dict[str, list] | None = None
        self._cache: dict = {}
        self._read_header_only()
        if not self._load_index():
            # Invalid source indexes are never overwritten. Rebuild a private
            # cache index instead; explicit index_path also isolates integration tests.
            if self.index_error and self._index_override is None:
                stat = self.path.stat()
                cache = self.path.parent / ".cache"
                cache.mkdir(exist_ok=True)
                self._index_override = cache / f"{self.path.name}.{stat.st_size}.{stat.st_mtime_ns}.v2.bai"
            try:
                if self._index_override is not None and self._index_override.exists() and self._load_index():
                    return
                if self.build_index() and self._load_index():
                    return
            except (OSError, ValueError, struct.error) as exc:
                self.index_error = str(exc)
            self._load(max_reads)

    # ---- 头部 / 索引 ---------------------------------------------------
    def _read_header_only(self) -> None:
        st = _BgzfStream(self.path)
        try:
            if st.read(4) != b"BAM\x01":
                raise ValueError("not a BAM file")
            (l_text,) = struct.unpack("<i", st.read(4))
            st.read(l_text)
            (n_ref,) = struct.unpack("<i", st.read(4))
            names = []
            for _ in range(n_ref):
                (l_name,) = struct.unpack("<i", st.read(4))
                nm = st.read(l_name).rstrip(b"\x00").decode("utf-8", "replace")
                (l_ref,) = struct.unpack("<i", st.read(4))
                names.append((nm, l_ref))
            self.chroms = {nm: l for nm, l in names}
            self._refs = names
            self._probe_read_stats(st)
        finally:
            st.close()

    def _probe_read_stats(self, st):
        """最多读取 8 MiB/10000 条记录，并仅统计前 1000 条 mapped。"""
        consumed = 0
        for _ in range(_EXPERIMENT_PROBE_RECORDS):
            if len(self._read_stats.read_lengths) >= _EXPERIMENT_SAMPLE_READS:
                break
            if consumed + 4 > _EXPERIMENT_PROBE_BYTES:
                break
            size_data = st.read(4)
            if len(size_data) < 4:
                break
            size = _I32.unpack(size_data)[0]
            consumed += 4
            if size < 32 or size > _EXPERIMENT_PROBE_BYTES - consumed:
                break
            blk = st.read(size)
            consumed += size
            if len(blk) != size:
                break
            ref_id, _pos, name_len, _mq, _bin, ncig, flag = _REC_HDR.unpack_from(blk)
            if flag & 4 or ref_id < 0 or ref_id >= len(self._refs):
                continue
            if 32 + name_len + ncig * 4 > size:
                break
            read_length = _I32.unpack_from(blk, 16)[0]
            ops = []
            for i in range(ncig):
                cv = _U32.unpack_from(blk, 32 + name_len + i * 4)[0]
                ops.append((cv >> 4, cv & 15))
            self._read_stats.add(read_length, ops)
            self.has_seq |= read_length > 0
            self.paired |= bool(flag & 1)

    def _bai_path(self):
        """Find BAI sidecars; CSI is not supported by this reader."""
        override = getattr(self, "_index_override", None)
        if override is not None:
            return override if override.exists() else None
        cands = [Path(str(self.path) + ".bai")]
        try:
            cands.append(self.path.with_suffix(".bai"))
        except ValueError:
            pass
        for c in cands:
            if c.exists():
                return c
        return None

    def _load_index(self) -> bool:
        bp = self._bai_path()
        if bp is None:
            return False
        try:
            data = bp.read_bytes()
        except OSError:
            return False
        if data[:4] != b"BAI\x01":
            return False
        o = 4
        bam_size = self.path.stat().st_size
        try:
            (n_ref,) = struct.unpack_from("<i", data, o); o += 4
            if n_ref != len(self._refs):
                raise ValueError("BAI reference count does not match BAM")
            bins_by_ref = []
            lin_by_ref = []
            for _ in range(n_ref):
                (n_bin,) = struct.unpack_from("<i", data, o); o += 4
                bm = {}
                for _ in range(n_bin):
                    bi, n_chunk = struct.unpack_from("<Ii", data, o); o += 8
                    ch = []
                    for _ in range(n_chunk):
                        b, e = struct.unpack_from("<QQ", data, o); o += 16
                        # 37450 is optional metadata (counts, not virtual offsets).
                        if bi != 37450 and (b >= e or (e >> 16) > bam_size):
                            raise ValueError("Invalid BAI chunk offsets; rebuilding private index")
                        ch.append((b, e))
                    if ch and bi != 37450:
                        bm[bi] = ch
                (n_intv,) = struct.unpack_from("<i", data, o); o += 4
                lin = [struct.unpack_from("<Q", data, o + 8 * i)[0] for i in range(n_intv)] if n_intv else []
                o += 8 * n_intv
                bins_by_ref.append(bm)
                lin_by_ref.append(lin)
        except (struct.error, IndexError, ValueError) as exc:
            self.index_error = str(exc)
            return False
        names = [nm for nm, _ in getattr(self, "_refs", [])]
        self._bins = {}
        self._lin = {}
        for i, bm in enumerate(bins_by_ref):
            if i < len(names) and bm:
                self._bins[names[i]] = bm
                if i < len(lin_by_ref):
                    self._lin[names[i]] = lin_by_ref[i]
        self._chunks = self._bins if self._bins else None
        return bool(self._bins)

    def _bin_chunks(self, chrom, start, end):
        """BAI 的 bin 层级过滤：只取和窗口重叠的 bin 的 chunk。

        不能把所有 chunk 合并成一个——BAM 索引里 bin 0 代表整条染色体，
        合并之后等于每次查询都从染色体开头扫，几千万条记录要几十秒。
        """
        bm = (self._bins or {}).get(chrom)
        if not bm:
            return [], 0
        end = min(end, 1 << 29)
        if end <= start:
            return [], 0
        e = end - 1
        # bin 0 也可能包含跨越大区间的真实比对，不能为提速丢弃。
        # 扫描下限由 BAI 线性索引控制。
        want = {0}
        for lo, sh in ((1, 26), (9, 23), (73, 20), (585, 17), (4681, 14)):
            for k in range(lo + (start >> sh), lo + (e >> sh) + 1):
                want.add(k)
        ch = []
        for bi in want:
            got = bm.get(bi)
            if got:
                ch.extend(got)
        ch.sort()
        merged = []
        for b, ce in ch:
            if merged and b <= merged[-1][1]:
                if ce > merged[-1][1]:
                    merged[-1][1] = ce
            else:
                merged.append([b, ce])
        lin = (self._lin or {}).get(chrom) or []
        k = start >> 14
        floor_v = lin[k] if k < len(lin) and lin[k] else 0
        return [tuple(x) for x in merged], floor_v

    # ---- 自建索引（有 IGV 的 SamIndexer 同样的作用：没有 .bai 时扫一遍生成） ----
    @staticmethod
    def _reg2bin(beg: int, end: int) -> int:
        end -= 1
        if beg >> 14 == end >> 14:
            return 4681 + (beg >> 14)
        if beg >> 17 == end >> 17:
            return 585 + (beg >> 17)
        if beg >> 20 == end >> 20:
            return 73 + (beg >> 20)
        if beg >> 23 == end >> 23:
            return 9 + (beg >> 23)
        if beg >> 26 == end >> 26:
            return 1 + (beg >> 26)
        return 0

    def build_index(self) -> bool:
        """扫一遍 BAM，写出 BAI 的 bin/chunk 与 16 kb 线性索引。

        没有索引时需顺序扫描；此实现的外部工具互操作性未在本测试中验证。
        """
        n_ref = len(getattr(self, "_refs", []) or [])
        if n_ref == 0:
            return False
        bins = [dict() for _ in range(n_ref)]        # refID -> bin -> [[beg, end], ...]
        lin = [dict() for _ in range(n_ref)]         # refID -> 16kb 窗口 -> 最小虚拟偏移
        st = _BgzfStream(self.path)
        hdr_un = _REC_HDR.unpack_from
        u32 = _U32.unpack_from
        try:
            if st.read(4) != b"BAM\x01":
                return False
            (l_text,) = struct.unpack("<i", st.read(4))
            st.read(l_text)
            (hdr_n) = struct.unpack("<i", st.read(4))[0]
            for _ in range(hdr_n):
                (l_name,) = struct.unpack("<i", st.read(4))
                st.read(l_name)
                st.read(4)
            previous = None
            while True:
                # Capture offset BEFORE reading: the four-byte length prefix can
                # itself straddle BGZF blocks. Never combine a new buf_v with pos
                # from the preceding block.
                voff = st.tell()
                hdr = st.read(4)
                if not hdr:
                    break
                if len(hdr) != 4:
                    raise ValueError("Truncated BAM record length")
                bs = _I32.unpack(hdr)[0]
                if bs < 32:
                    raise ValueError("Invalid BAM record size")
                blk = st.read(bs)
                end_voff = st.tell()
                if len(blk) != bs:
                    raise ValueError("Truncated BAM record")
                refID, rpos, lrn, _mapq, _bin, ncig, _flag = hdr_un(blk)
                if refID < 0 or refID >= n_ref or rpos < 0:
                    continue
                coord = (refID, rpos)
                if previous is not None and coord < previous:
                    raise ValueError("BAM must be coordinate-sorted to build BAI")
                previous = coord
                if rpos >= (1 << 29):
                    raise ValueError("BAI coordinate limit exceeded; CSI support required")
                cigar_off = 32 + lrn
                refend = rpos
                for ci in range(ncig):
                    (c,) = u32(blk, cigar_off + ci * 4)
                    if (c & 0xF) in _CIGAR_REF:
                        refend += c >> 4
                if refend <= rpos:
                    refend = rpos + 1
                b = self._reg2bin(rpos, refend)
                ch = bins[refID].setdefault(b, [])
                if ch and voff <= ch[-1][1]:
                    if end_voff > ch[-1][1]:
                        ch[-1][1] = end_voff
                else:
                    ch.append([voff, end_voff])
                lm = lin[refID]
                for w in range(rpos >> 14, ((refend - 1) >> 14) + 1):
                    cur = lm.get(w)
                    if cur is None or voff < cur:
                        lm[w] = voff
        finally:
            st.close()

        # ---- 写 BAI ----
        out = bytearray(b"BAI\x01")
        out += struct.pack("<i", n_ref)
        for i in range(n_ref):
            bm = bins[i]
            out += struct.pack("<i", len(bm))
            for b, chs in sorted(bm.items()):
                out += struct.pack("<Ii", b, len(chs))
                for beg, end in chs:
                    out += struct.pack("<QQ", beg, end)
            lm = lin[i]
            n_intv = (max(lm) + 1) if lm else 0
            out += struct.pack("<i", n_intv)
            last = 0
            for w in range(n_intv):
                v = lm.get(w, last)
                out += struct.pack("<Q", v)
                last = v
        target = getattr(self, "_index_override", None) or Path(str(self.path) + ".bai")
        temporary = target.with_name(target.name + f".{os.getpid()}.{threading.get_ident()}.tmp")
        try:
            with open(temporary, "xb") as handle:
                handle.write(out)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
        except OSError:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
            return False
        return True

    def _scan(self, chrom, start, end):
        """按索引扫窗口内的记录，产出 (起点, 终点, 虚拟偏移)。"""
        chunks, floor_v = self._bin_chunks(chrom, start, end)
        if not chunks:
            return
        st = _BgzfStream(self.path)
        hdr_un = _REC_HDR.unpack_from
        u32 = _U32.unpack_from
        try:
            for beg, cend in chunks:
                beg = max(beg, floor_v)   # 线性索引把起点压到窗口附近，别从 0 开始扫
                if beg >= cend:
                    continue
                try:
                    st.seek_virtual(beg)
                except ValueError:
                    break
                while True:
                    if st.buf_v + st.pos >= cend:
                        break
                    buf = st.buf
                    pos = st.pos
                    v = st.tell()
                    if len(buf) - pos < 4:
                        st.pos = pos
                        hdr = st.read(4)
                        if len(hdr) < 4:
                            return
                        (bs,) = _I32.unpack_from(hdr, 0)
                        if bs <= 0:
                            return
                        blk = st.read(bs)
                    else:
                        (bs,) = _I32.unpack_from(buf, pos)
                        if bs <= 0:
                            return
                        if len(buf) - pos - 4 < bs:
                            st.pos = pos
                            st.read(4)
                            blk = st.read(bs)
                        else:
                            blk = buf[pos + 4:pos + 4 + bs]
                            st.pos = pos + 4 + bs
                    if len(blk) < 32:
                        return
                    refID, rpos, lrn, _mapq, _bin, ncig, flag = hdr_un(blk)
                    if refID < 0 or refID >= len(self._refs):
                        continue
                    if self._refs[refID][0] != chrom:
                        continue
                    if rpos >= end:
                        return
                    cigar_off = 32 + lrn
                    refend = rpos
                    for ci in range(ncig):
                        (c,) = u32(blk, cigar_off + ci * 4)
                        op = c & 0xF
                        if op in _CIGAR_REF:
                            refend += c >> 4
                    if refend <= rpos:
                        continue
                    if refend > start and _passes_igv_defaults(flag):
                        yield rpos, refend, v, blk
        finally:
            st.close()

    def _load(self, max_reads: int | None) -> None:
        raw: dict[str, list] = {}
        voff: dict[str, array] = {}
        st = _BgzfStream(self.path)
        try:
            if st.read(4) != b"BAM\x01":
                raise ValueError("not a BAM file")
            (l_text,) = struct.unpack("<i", st.read(4))
            st.read(l_text)
            (n_ref,) = struct.unpack("<i", st.read(4))
            refs = []
            for _ in range(n_ref):
                (l_name,) = struct.unpack("<i", st.read(4))
                nm = st.read(l_name).rstrip(b"\x00").decode("utf-8", "replace")
                (l_ref,) = struct.unpack("<i", st.read(4))
                refs.append((nm, l_ref))
            self.chroms = {nm: l for nm, l in refs}

            n = 0
            hdr_un = _REC_HDR.unpack_from
            u32 = _U32.unpack_from
            # 热路径：绝大多数记录都完整落在同一个 BGZF 块内，直接在 st.buf 上
            # 按下标解析（省掉每条记录两次方法调用 + 一次 4 字节切片）。
            # 只有跨块的少数记录退回 st.read()。
            while True:
                buf = st.buf
                pos = st.pos
                v = st.tell()
                if len(buf) - pos < 4:
                    # 记录头跨块（或走到文件末尾的空块）：交给 st.read 处理
                    st.pos = pos
                    hdr = st.read(4)
                    if len(hdr) < 4:
                        break
                    (bs,) = _I32.unpack_from(hdr, 0)
                    if bs <= 0:
                        break
                    blk = st.read(bs)
                else:
                    (bs,) = _I32.unpack_from(buf, pos)
                    if bs <= 0:
                        break
                    if len(buf) - pos - 4 < bs:
                        st.pos = pos
                        st.read(4)
                        blk = st.read(bs)
                    else:
                        blk = buf[pos + 4:pos + 4 + bs]
                        st.pos = pos + 4 + bs
                if len(blk) < 32:
                    break
                refID, pos, lrn, _mapq, _bin, ncig, flag = hdr_un(blk)
                if not _passes_igv_defaults(flag):
                    continue
                lseq = _I32.unpack_from(blk, 16)[0]
                if lseq > 0:
                    self.has_seq = True
                if flag & 1:
                    self.paired = True
                if refID < 0 or refID >= n_ref:
                    continue
                cigar_off = 32 + lrn
                refend = pos
                for ci in range(ncig):
                    (c,) = u32(blk, cigar_off + ci * 4)
                    op = c & 0xF
                    if op in _CIGAR_REF:
                        refend += c >> 4
                if refend <= pos:
                    continue
                chrom = refs[refID][0]
                if max_reads is not None and max_reads > 0 and n >= max_reads:
                    self.truncated = True
                    break
                arr = voff.get(chrom)
                if arr is None:
                    arr = voff[chrom] = array("Q")
                    raw[chrom] = []
                raw[chrom].append((pos, refend))
                arr.append(v)
                n += 1
        finally:
            st.close()

        self.n_reads = n
        for c, lst in raw.items():
            vs = voff[c]
            # 坐标排序的 BAM 天然有序；万一是乱序（未排序文件），
            # 必须把偏移一起重排，否则偏移和区间会错位
            if any(lst[i][0] < lst[i - 1][0] for i in range(1, len(lst))):
                order = sorted(range(len(lst)), key=lambda i: lst[i][0])
                lst = [lst[i] for i in order]
                vs = array("Q", (vs[i] for i in order))
            self._iv[c] = _Intervals(lst)
            self._voff[c] = vs
        self.total = {"max": None}

    def summary(self, chrom, start, end, bins):
        c = self.resolve_chrom(chrom)
        if self._chunks is not None:
            key = (c, start, end, bins)
            hit = self._cache.get(key)
            if hit is not None:
                return hit
            def aligned_blocks():
                for _s, _e, _v, blk in self._scan(c, start, end):
                    yield from _bam_aligned_blocks(blk)
            out = _coverage_summary(aligned_blocks(), start, end, bins)
            if len(self._cache) > 24:
                self._cache.clear()
            self._cache[key] = out
            return out
        it = self._iv.get(c)
        voffs = self._voff.get(c)
        if it is None or not voffs:
            return []
        def aligned_blocks():
            st = _BgzfStream(self.path)
            try:
                for i in it.overlapping_idx(start, end):
                    blk = st.read_record(voffs[i])
                    if blk is not None:
                        yield from _bam_aligned_blocks(blk)
            finally:
                st.close()
        return _coverage_summary(aligned_blocks(), start, end, bins)

    def junctions(self, chrom, start, end, min_count: int = 1):
        """窗口内的剪接位点（CIGAR 的 N 段）按 (donor, acceptor, strand) 聚合。

        参考 IGV 的 SpliceJunctionHelper：不额外读盘，就在已取回的记录块上解析。
        donor/acceptor 用 0-based 半开区间，和 BED 一致。
        """
        c = self.resolve_chrom(chrom)
        agg = {}
        u32 = _U32.unpack_from
        hdr_un = _REC_HDR.unpack_from
        blocks = []
        if self._chunks is not None:
            blocks = [b for (_s, _e, _v, b) in self._scan(c, start, end)]
        else:
            itv = self._iv.get(c)
            voffs = self._voff.get(c) or []
            if itv is not None and voffs:
                st = _BgzfStream(self.path)
                try:
                    for i in itv.overlapping_idx(start, end):
                        blk = st.read_record(voffs[i])
                        if blk is not None:
                            blocks.append(blk)
                finally:
                    st.close()
        for blk in blocks:
            refID, rpos, lrn, _mq, _bn, ncig, flag = hdr_un(blk)
            # IGV：TS 优先于 XS；无标签时 paired first-of-pair strand，单端看 FLAG。
            aux_off = 32 + lrn + ncig * 4
            lseq = struct.unpack_from("<i", blk, 16)[0]
            aux_off += (lseq + 1) // 2 + lseq
            tags = _bam_aux_tags(blk, aux_off)
            attr = tags.get("TS", tags.get("XS"))
            if isinstance(attr, str) and attr:
                strand = '-' if attr[0] == '-' else '+'
            elif flag & 0x1:
                neg = bool(flag & 0x10) if (flag & 0x40) else bool(flag & 0x20)
                strand = '-' if neg else '+'
            else:
                strand = '-' if (flag & 0x10) else '+'
            cur = rpos
            left_flank = 0
            off = 32 + lrn
            for ci in range(ncig):
                (cv,) = u32(blk, off + ci * 4)
                op = cv & 0xF
                ln = cv >> 4
                if op == 3:              # N：剪接，坐标为 0-based 半开
                    d, a = cur, cur + ln
                    right_flank = 0
                    for cj in range(ci + 1, ncig):
                        nv = u32(blk, off + cj * 4)[0]
                        nop, nlen = nv & 0xF, nv >> 4
                        if nop in (0, 7, 8):
                            right_flank += nlen
                        elif nop in _CIGAR_REF:
                            break
                        else:
                            continue
                    if left_flank >= 0 and right_flank >= 0 and a > start and d < end:
                        k = (d, a, strand)
                        agg[k] = agg.get(k, 0) + 1
                if op in (0, 7, 8):
                    left_flank += ln
                elif op in _CIGAR_REF:
                    left_flank = 0
                cur += ln if op in _CIGAR_REF else 0
        out = [{"d": d, "a": a, "strand": st2, "n": n}
               for (d, a, st2), n in agg.items() if n >= min_count]
        out.sort(key=lambda x: -x["n"])
        return out

    def has_reads(self, chrom):
        """该染色体是否有任何比对记录（BAM 头里声明 ≠ 实际有数据）。"""
        c = self.resolve_chrom(chrom)
        if self._chunks is not None:
            return c in self._chunks
        return c in self._iv

    # ---- 比对视图（IGV 的 reads 堆叠） --------------------------------
    def reads(self, chrom, start, end, max_n=None, ref=None):
        """返回窗口内全部比对；仅内部调用显式正整数 max_n 时截断。

        参考序列按窗口读取一次，错配偏移仍相对于 read 起点。
        """
        c = self.resolve_chrom(chrom)
        limit = max_n if isinstance(max_n, int) and max_n > 0 else None
        refseq = None
        if ref is not None:
            try:
                refseq = ref(chrom, start, end)
            except Exception:  # noqa: BLE001
                pass
        out = []
        total = 0

        def append_read(blk):
            rec = _decode_read(blk)
            if rec is None:
                return
            if rec["lseq"] and refseq:
                rec["mm"] = _mismatches(rec, refseq, start, (start, end))
            out.append({"p": rec["p"], "e": rec["e"], "q": rec["q"],
                        "f": rec["f"], "n": rec["n"], "c": rec["c"],
                        "mm": rec["mm"]})

        if self._chunks is not None:
            # 直接解码扫描器已读出的记录，不缓存整个窗口的原始 BAM 块。
            for _s, _e, _v, blk in self._scan(c, start, end):
                total += 1
                if limit is None or total <= limit:
                    append_read(blk)
        else:
            it = self._iv.get(c)
            voffs = self._voff.get(c)
            if it is None or not voffs:
                return [], 0, False
            idxs = it.overlapping_idx(start, end)
            total = len(idxs)
            if limit is not None:
                idxs = idxs[:limit]
            st = _BgzfStream(self.path)
            try:
                for i in idxs:
                    blk = st.read_record(voffs[i])
                    if blk is not None:
                        append_read(blk)
            finally:
                st.close()
        return out, total, limit is not None and total > limit

    def meta(self):
        m = super().meta()
        m["indexed"] = self._chunks is not None
        m["reads"] = None if self._chunks is not None else self.n_reads
        m["truncated"] = bool(self.truncated)
        m["hasSeq"] = self.has_seq
        m["paired"] = self.paired
        m.update(self._read_stats.meta())
        return m


class SamSignal(BaseTrack):
    """以 BAM 相同接口提供 SAM 文本比对的覆盖度及 reads。

    SAM 完整解析到内存，区间用于查询、解码记录用于覆盖度和堆叠视图；
    无需 BGZF 或虚拟偏移。仅显式 max_reads 才限制导入记录数。
    """

    kind = "signal"

    def __init__(self, tid, name, path, max_reads: int | None = None):
        super().__init__(tid, name, path, "sam")
        self._iv: dict[str, _Intervals] = {}
        self._recs: dict[str, list] = {}
        self.truncated = False
        self.n_reads = 0
        self.has_seq = False
        self.paired = False
        self._read_stats = _ReadStats()
        self._load(max_reads)

    def _load(self, max_reads: int | None) -> None:
        ivs: dict[str, list] = {}
        recs: dict[str, list] = {}
        chroms: dict[str, int] = {}
        with _open_text(self.path) as f:
            for raw in f:
                if not raw.strip():
                    continue
                if raw[0] == "@":
                    if raw.startswith("@SQ"):
                        sn = ln = None
                        for kv in raw.rstrip("\r\n").split("\t")[1:]:
                            k, _, v = kv.partition(":")
                            if k == "SN":
                                sn = v
                            elif k == "LN":
                                try:
                                    ln = int(v)
                                except ValueError:
                                    pass
                        if sn is not None and ln is not None:
                            chroms[sn] = ln
                    continue
                p = raw.rstrip("\r\n").split("\t")
                if len(p) < 11:
                    continue
                rname, pos_s, cigar = p[2], p[3], p[5]
                if rname == "*" or not pos_s.isdigit() or int(pos_s) < 1:
                    continue
                try:
                    flag = int(p[1])
                    mapq = int(p[4])
                except ValueError:
                    continue
                start = int(pos_s) - 1
                ops = []
                ref_len = 0
                num = 0
                bad = False
                for ch in cigar:
                    if ch.isdigit():
                        num = num * 10 + int(ch)
                        continue
                    idx = _CIGAR_OPS.find(ch)
                    if idx < 0:
                        bad = True
                        break
                    ops.append((num, idx))
                    if idx in _CIGAR_REF:
                        ref_len += num
                    num = 0
                if bad or ref_len <= 0:
                    continue
                if not flag & 4:
                    self._read_stats.add(len(p[9]) if p[9] != "*" else 0, ops)
                # 实验类型采样保留所有 mapped，展示沿用 IGV 默认 FLAG 过滤。
                if not _passes_igv_defaults(flag):
                    continue
                if max_reads is not None and max_reads > 0 and self.n_reads >= max_reads:
                    self.truncated = True
                    break
                seq = p[9]
                if seq == "*":
                    seq = ""
                else:
                    self.has_seq = True
                if flag & 0x1:
                    self.paired = True
                end = start + ref_len
                ivs.setdefault(rname, []).append((start, end))
                recs.setdefault(rname, []).append({
                    "p": start, "e": end, "q": mapq, "f": flag,
                    "n": p[0], "c": cigar, "seq": seq.upper(), "ops": ops,
                })
                self.n_reads += 1

        self._recs = recs
        self._iv = {c: _Intervals(lst) for c, lst in ivs.items()}
        # @SQ 里声明的长度优先；没有 @SQ 时用实际覆盖末端兜底
        for c, lst in ivs.items():
            chroms.setdefault(c, max(e for _, e in lst))
        self.chroms = chroms

    def summary(self, chrom, start, end, bins):
        recs = self._recs.get(self.resolve_chrom(chrom))
        if not recs:
            return []
        def aligned_blocks():
            for rec in recs:
                if rec["e"] <= start or rec["p"] >= end:
                    continue
                pos = rec["p"]
                for length, op in rec["ops"]:
                    if op in (0, 7, 8):
                        yield pos, pos + length
                    if op in _CIGAR_REF:
                        pos += length
        return _coverage_summary(aligned_blocks(), start, end, bins)

    def has_reads(self, chrom):
        return self.resolve_chrom(chrom) in self._iv

    def reads(self, chrom, start, end, max_n=None, ref=None):
        c = self.resolve_chrom(chrom)
        lst = self._recs.get(c)
        if not lst:
            return [], 0, False
        hits = [r for r in lst if r["e"] > start and r["p"] < end]
        total = len(hits)
        limit = max_n if isinstance(max_n, int) and max_n > 0 else None
        sampled = limit is not None and total > limit
        if limit is not None:
            hits = hits[:limit]
        refseq = None
        if ref is not None:
            try:
                refseq = ref(chrom, start, end)
            except Exception:  # noqa: BLE001
                pass
        out = []
        for r in hits:
            mm = _mismatches(r, refseq, start, (start, end)) if r["seq"] and refseq else []
            out.append({"p": r["p"], "e": r["e"], "q": r["q"], "f": r["f"],
                        "n": r["n"], "c": r["c"], "mm": mm})
        return out, total, sampled

    def meta(self):
        m = super().meta()
        m["reads"] = self.n_reads
        m["truncated"] = self.truncated
        m["hasSeq"] = self.has_seq
        m["paired"] = self.paired
        m.update(self._read_stats.meta())
        return m


# --------------------------------------------------------------------------- #
# GTF / GFF
# --------------------------------------------------------------------------- #
_ATTR_GTF = re.compile(r'(\S+)\s+"([^"]*)"')
_ATTR_GFF = re.compile(r"(\S+)=([^;]+)")


def _gtf_val(s: str, key: str):
    """GTF 属性串里取 ``key "value"`` 的 value（没有就 None）。

    比正则快一个数量级：``str.find`` 是 C 层扫描，而 ``gene "`` 里的空格
    天然把它和 ``gene_id "`` 区分开，不会误命中。
    """
    i = s.find(key + ' "')
    if i < 0:
        return None
    j = i + len(key) + 2
    e = s.find('"', j)
    return s[j:e] if e > j else None


def _parse_attrs(s: str) -> dict:
    # 快路径：标准 GTF 只取真正用到的三个键，其余走正则兜底（GFF3 等）
    gid = _gtf_val(s, "gene_id")
    if gid is not None:
        d = {"gene_id": gid}
        v = _gtf_val(s, "transcript_id")
        if v is not None:
            d["transcript_id"] = v
        v = _gtf_val(s, "gene_name")
        if v is not None:
            d["gene_name"] = v
        return d
    d = {m.group(1): m.group(2).strip().strip('"') for m in _ATTR_GFF.finditer(s)}
    if not d:
        d = {m.group(1): m.group(2) for m in _ATTR_GTF.finditer(s)}
    return d


def _open_text(path):
    """按魔数打开文本文件，透明支持 .gz / .bgz（不能只看扩展名）。"""
    try:
        with open(path, "rb") as f:
            magic = f.read(2)
    except OSError:
        magic = b""
    if magic == b"\x1f\x8b":
        return gzip.open(path, "rt", encoding="utf-8", errors="replace", newline="")
    return open(path, "r", encoding="utf-8", errors="replace")


# GFF3 的 ID 常带 SO 前缀（gene:ENSG… / transcript:ENST… / CDS:ENSP…）。
# 分组和展示都只想要裸 ID，否则转录本会显示成 "transcript:ENST…"。
_ID_PREFIXES = frozenset((
    "gene", "transcript", "exon", "cds", "mrna", "pseudogene", "utr",
    "five_prime_utr", "three_prime_utr", "ncrna", "trna", "rrna", "mirna",
    "snrna", "snorna", "lnc_rna", "pseudogenic_transcript", "primary_transcript",
))


# 转录本级 feature（GFF3 里 mRNA / lnc_RNA / transcript …）。用来区分
# 「真正的转录本」和 region / supercontig / match 这类顶层 feature。
_TX_FEATS = frozenset((
    "mrna", "transcript", "ncrna", "lncrna", "lnc_rna", "trna", "rrna",
    "mirna", "snrna", "snorna", "scrna", "pseudogenic_transcript",
    "primary_transcript", "v_gene_segment", "c_gene_segment",
    "d_gene_segment", "j_gene_segment",
))


def _strip_id_prefix(v):
    if not v:
        return v
    i = v.find(":")
    if i > 0 and v[:i].lower() in _ID_PREFIXES:
        return v[i + 1:]
    return v


def _gff_val(s: str, key: str):
    """GFF3 属性串里取 ``key=value`` 的 value（没有就 None）。

    和 ``_gtf_val`` 一样走 ``str.find``；额外要求 key 前面是行首或 ``;``，
    免得 ``gene`` 命中 ``pseudogene``、``ID`` 命中 ``exon_id``。
    """
    i = s.find(key + "=")
    if i < 0:
        return None
    if i > 0 and s[i - 1] not in "; ":
        return None
    j = i + len(key) + 1
    e = s.find(";", j)
    v = (s[j:e] if e >= 0 else s[j:]).strip()
    return v or None


def _looks_like_repeat_gtf(path) -> bool:
    """嗅探 RepeatMasker / TE 注释（UCSC rmsk 风格）。

    这类文件的第 9 列带 ``family_id "Alu"; class_id "SINE";``，来源列常是
    ``UCSC_rmsk`` / ``RepeatMasker``。它和普通 GTF 的关键差别不在语法，而在
    **语义**：``gene_id`` 是重复家族名（AluY、L1P5…），同名拷贝在基因组里有
    成千上万个，只有 ``transcript_id`` 是每个拷贝唯一的 id。
    """
    try:
        with _open_text(path) as f:
            for _ in range(40):
                line = f.readline()
                if not line:
                    break
                if line.startswith("#"):
                    continue
                cols = line.split("\t")
                if len(cols) < 9:
                    continue
                attr = cols[8]
                if 'family_id "' in attr or 'class_id "' in attr:
                    return True
                src = cols[1].lower()
                if "rmsk" in src or "repeatmasker" in src:
                    return True
    except OSError:
        pass
    return False


def _looks_like_gff3(path) -> bool:
    """按内容判断格式（不信扩展名）：GFF3 属性是 ``k=v;``，GTF 是 ``k "v";``。"""
    try:
        with _open_text(path) as f:
            for _ in range(60):
                line = f.readline()
                if not line:
                    break
                if line.startswith("##gff-version"):
                    return True
                if line.startswith("#"):
                    continue
                cols = line.split("\t")
                if len(cols) >= 9:
                    attr = cols[8]
                    return "=" in attr and '"' not in attr
    except OSError:
        pass
    return False


# 复合扩展名：GDC 的拷贝数分段文件叫 xxx.seg.txt（Path().suffix 只会给出 .txt），
# 所以先按整串匹配，再退回普通单扩展名。压缩后缀在匹配前已经剥掉。
_COMPOUND_EXT = (
    (".seg.txt", "seg", ".seg.txt"),
    (".seg.tsv", "seg", ".seg.tsv"),
)


def _split_ext(name: str):
    """文件名 → (格式键, 保存用扩展名)。``x.gtf.gz`` → ``('gtf', '.gtf.gz')``"""
    low = Path(name).name.lower()
    comp = ""
    if low.endswith(".gz"):
        comp, low = ".gz", low[:-3]
    elif low.endswith(".bgz"):
        comp, low = ".bgz", low[:-4]
    for suf, fmt, save in _COMPOUND_EXT:
        if low.endswith(suf):
            return fmt, save + comp
    return FORMAT_BY_EXT.get(Path(low).suffix), Path(low).suffix + comp


class GtfTrack(BaseTrack):
    kind = "gene"
    # bump when the parser output changes so old caches are dropped
    _CACHE_VER = 4          # GTF parser output version
    _GFF3_CACHE_VER = 1     # GFF3 parser output version

    def __init__(self, tid, name, path):
        super().__init__(tid, name, path, "gtf")
        # GFF3 和 GTF 是两套完全不同的属性语法，必须分开解析
        self._is_gff3 = _looks_like_gff3(path)
        self._genes = self._load_or_parse()
        self.chroms = {}
        for g in self._genes:
            self.chroms[g.chrom] = max(self.chroms.get(g.chrom, 0), g.end)

    # --------------------------------------------------------- parse caching
    # A whole-genome GTF (Ensembl GRCh38 is ~1.5 GB) takes ~20 s to parse.
    # The parsed gene models are pickled and reused while the source *content*
    # stays the same, which keeps repeat imports instant.
    def cache_path(self) -> Path:
        return self.path.parent / ".cache" / f"{self._fp()}.gtf.pkl"

    def _fp(self) -> str:
        fp = self.__dict__.get("_fingerprint")
        if fp is None:
            fp = self._fingerprint = _quick_fingerprint(self.path)
        return fp

    def _signature(self):
        # 内容指纹已经覆盖了文件内容，签名只需要带上解析器版本。
        # GFF3 用独立版本号：修 GFF3 解析时不会把 1.5 GB GTF 的缓存一起作废。
        if self._is_gff3:
            return (self._CACHE_VER, "gff3", self._GFF3_CACHE_VER)
        return (self._CACHE_VER,)

    def _load_or_parse(self) -> list:
        try:
            cp = self.cache_path()
            sig = self._signature()
        except OSError:
            return self._parse()
        try:
            with open(cp, "rb") as f:
                blob = pickle.load(f)
            if blob.get("sig") == sig and isinstance(blob.get("genes"), list):
                try:
                    cp.touch()          # 让 LRU 淘汰时优先保留刚用过的
                except OSError:
                    pass
                return blob["genes"]
        except (OSError, pickle.UnpicklingError, EOFError, AttributeError, ValueError):
            pass
        genes = self._parse()
        try:
            cp.parent.mkdir(parents=True, exist_ok=True)
            tmp = cp.with_suffix(".tmp")
            with open(tmp, "wb") as f:
                pickle.dump({"sig": sig, "genes": genes}, f, protocol=4)
            tmp.replace(cp)
            _prune_cache(cp.parent, 6)
        except OSError:
            pass
        return genes

    def _parse(self) -> list:
        return self._parse_gff3() if self._is_gff3 else self._parse_gtf()

    def _parse_gtf(self) -> list:
        # gene_id -> {chrom,strand,name,start,end, tx:{tid:{start,end,exons,cds}}}
        genes: dict[str, dict] = {}
        gget = genes.get
        feat_code = _FEAT_CODE

        # 热循环：全基因组 GTF 有 300 多万行，这里每省一次函数调用/正则都值。
        # 标准 GTF 走 _gtf_val 直取（不建 dict、不跑正则），GFF3 才回退到正则。
        with _open_text(self.path) as f:
            for line in f:
                if not line or line[0] == "#":
                    continue
                cols = line.split("\t")
                if len(cols) < 9:
                    continue
                try:
                    s = int(cols[3]) - 1     # GTF is 1-based inclusive
                    e = int(cols[4])
                except ValueError:
                    continue
                if e <= s:
                    continue
                chrom = cols[0]
                feature = cols[2]
                attr = cols[8]
                # BRAKER / AUGUSTUS 的 GFF3 会把每条 intron 单独列一行
                # （ID=g247.t1.intron2;Parent=g247.t1）。这些行没有 gene_id，
                # 会被当成独立基因画出一堆「xxx.t1.intron12」的框，必须跳过。
                # 外显子结构由 exon/CDS 行决定，intron 不需要单独入模型。
                if feature == "intron" or feature == "Intron":
                    continue

                gid = _gtf_val(attr, "gene_id")
                if gid is not None:
                    gn = _gtf_val(attr, "gene_name")
                    txid = _gtf_val(attr, "transcript_id")
                else:
                    a = _parse_attrs(attr)
                    gid = (a.get("gene_id") or a.get("gene")
                           or a.get("Parent") or a.get("ID"))
                    if not gid:
                        gid = a.get("gene_name") or "unknown"
                    gn = a.get("gene_name") or a.get("Name") or a.get("gene")
                    txid = a.get("transcript_id") or a.get("Parent")
                gname = gn or gid
                strand = cols[6]

                code = feat_code.get(feature)
                if code is None:
                    code = feat_code.get(feature.lower(), 0)

                g = gget(gid)
                if g is None:
                    g = genes[gid] = {"chrom": chrom, "strand": strand or "+",
                                      "name": gname or gid, "start": s, "end": e, "tx": {}}
                else:
                    # only overwrite when this line carries an explicit name;
                    # child lines that only have gene_id must not clobber the
                    # gene_name parsed from the ``gene`` line
                    if gn:
                        g["name"] = gn
                    if strand:
                        g["strand"] = strand
                    if s < g["start"]:
                        g["start"] = s
                    if e > g["end"]:
                        g["end"] = e

                if code == 3:            # gene / pseudogene 行只贡献基因边界
                    continue

                if not txid:
                    txid = gid
                elif "," in txid:
                    # GTF allows a comma separated transcript_id list
                    txid = txid.split(",")[0]

                t = g["tx"].get(txid)
                if t is None:
                    t = g["tx"][txid] = {"start": s, "end": e, "exons": [], "cds": []}
                else:
                    if s < t["start"]:
                        t["start"] = s
                    if e > t["end"]:
                        t["end"] = e

                if code == 1:            # exon
                    t["exons"].append((s, e))
                elif code == 2:          # CDS / start_codon / stop_codon
                    t["cds"].append((s, e))

        out: list[Gene] = []
        for gid, g in genes.items():
            if g["end"] <= 0 or g["start"] >= (1 << 62):
                continue
            txs = []
            for txid, t in g["tx"].items():
                exons = sorted(set(t["exons"])) or [(t["start"], t["end"])]
                cds = t["cds"]
                cs = min((c[0] for c in cds), default=0)
                ce = max((c[1] for c in cds), default=0)
                txs.append((txid, t["start"], t["end"], cs, ce, exons))
            if not txs:
                txs = [(gid, g["start"], g["end"], 0, 0, [(g["start"], g["end"])])]
            txs.sort(key=lambda t: t[1])
            out.append(Gene(g["chrom"], g["start"], g["end"], g["strand"], g["name"], txs))
        out.sort(key=lambda gg: (gg.chrom, gg.start))
        return out

    def _parse_gff3(self) -> list:
        """GFF3 解析（gene → mRNA/lnc_RNA/… → exon/CDS 三层）。

        与 GTF 不同：GFF3 的 exon/CDS 行用 ``Parent`` 指向**转录本**，CDS 行还
        带 ``ID=CDS:ENSP…``。若像 GTF 那样把 ``ID``/``Parent`` 当 gene_id，每个
        转录本会被拆成一个假基因、CDS 也会挂到别的组里 —— 这正是之前
        「UTR/CDS 看不到、行名是 transcript:ENST…」的根因。

        这里先按转录本聚合，再按 ``Parent`` 归到基因，与行的先后顺序无关；
        基因名取 gene 行的 ``Name``（ACTB），转录本名取裸 ID（ENST…）。
        """
        txs: dict[str, dict] = {}       # tid -> {chrom,strand,start,end,exons,cds,gene_name}
        tx_gene: dict[str, str] = {}    # tid -> gid（转录本行的 Parent）
        gene_meta: dict[str, dict] = {}  # gid -> {chrom,strand,name,start,end}
        gval = _gff_val
        strip = _strip_id_prefix

        with _open_text(self.path) as f:
            for line in f:
                if not line or line[0] == "#":
                    continue
                cols = line.split("\t")
                if len(cols) < 9:
                    continue
                try:
                    s = int(cols[3]) - 1     # GFF3 is 1-based inclusive
                    e = int(cols[4])
                except ValueError:
                    continue
                if e <= s:
                    continue
                chrom = cols[0]
                feat = cols[2].lower()
                strand = cols[6] if cols[6] in ("+", "-") else "+"
                attr = cols[8]

                # intron：BRAKER / AUGUSTUS 会把每条内含子单独列一行
                # （ID=g1.t1.intron1;Parent=g1.t1）。它带 Parent 但没有外显子信息，
                # 落进下面的「其余」分支会被当成一个新转录本，于是图上多出一堆
                # 「xxx.t1.intron12」的框。内含子由 exon 的间隙隐含，直接丢弃。
                if feat == "intron":
                    continue

                # ---- gene / pseudogene / *_gene：只记录基因名与边界
                if feat == "gene" or feat == "pseudogene" or feat.endswith("_gene"):
                    gid = strip(gval(attr, "gene_id")) or strip(gval(attr, "ID"))
                    if not gid:
                        continue
                    nm = gval(attr, "gene_name") or gval(attr, "Name") or gid
                    gm = gene_meta.get(gid)
                    if gm is None:
                        gene_meta[gid] = {"chrom": chrom, "strand": strand,
                                          "name": nm, "start": s, "end": e}
                    else:
                        if nm:
                            gm["name"] = nm
                        if s < gm["start"]:
                            gm["start"] = s
                        if e > gm["end"]:
                            gm["end"] = e
                    continue

                # ---- exon / CDS / UTR / codon：Parent = 转录本
                if (feat == "exon" or feat == "cds" or feat == "utr"
                        or feat in ("start_codon", "stop_codon")
                        or feat.endswith("_utr")):
                    tid = strip(gval(attr, "Parent")) or strip(gval(attr, "ID"))
                    if not tid:
                        continue
                    if "," in tid:            # 共享外显子可能挂多个转录本
                        tid = tid.split(",")[0]
                    tx = txs.get(tid)
                    if tx is None:
                        tx = txs[tid] = {"chrom": chrom, "strand": strand,
                                         "start": s, "end": e, "exons": [],
                                         "cds": [], "gene_name": None}
                    else:
                        if s < tx["start"]:
                            tx["start"] = s
                        if e > tx["end"]:
                            tx["end"] = e
                    if feat == "exon":
                        tx["exons"].append((s, e))
                    elif feat in ("cds", "start_codon", "stop_codon"):
                        tx["cds"].append((s, e))
                    # UTR 不单独记：exon 已覆盖 UTR 区段，前端按 CDS 内外区分粗细
                    continue

                # ---- 其余：只认带 Parent 的转录本级（mRNA/lnc_RNA/…）；
                #      region / supercontig / match 等顶层 feature 直接跳过
                parent = strip(gval(attr, "Parent"))
                if not parent and feat not in _TX_FEATS:
                    continue
                fid = strip(gval(attr, "transcript_id")) or strip(gval(attr, "ID"))
                tid = fid or parent
                gid = strip(gval(attr, "gene_id")) or parent or tid
                tx_gene[tid] = gid
                tx = txs.get(tid)
                if tx is None:
                    tx = txs[tid] = {"chrom": chrom, "strand": strand,
                                     "start": s, "end": e, "exons": [],
                                     "cds": [], "gene_name": gval(attr, "gene_name")}
                else:
                    if s < tx["start"]:
                        tx["start"] = s
                    if e > tx["end"]:
                        tx["end"] = e
                    if not tx.get("gene_name"):
                        tx["gene_name"] = gval(attr, "gene_name")

        # ---- 按基因聚合（与行序无关）
        by_gene: dict[str, list] = {}
        for tid in txs:
            gid = tx_gene.get(tid) or tid
            by_gene.setdefault(gid, []).append(tid)

        out: list[Gene] = []
        for gid, tids in by_gene.items():
            gm = gene_meta.get(gid)
            first = txs[tids[0]]
            chrom = (gm or {}).get("chrom") or first["chrom"]
            strand = (gm or {}).get("strand") or first["strand"]
            name = (gm or {}).get("name")
            if not name:
                name = next((txs[t]["gene_name"] for t in tids
                             if txs[t].get("gene_name")), None)
            if not name:
                name = gid
            gs = min(txs[t]["start"] for t in tids)
            ge = max(txs[t]["end"] for t in tids)
            if gm:
                gs = min(gs, gm["start"])
                ge = max(ge, gm["end"])
            tx_list = []
            for tid in sorted(tids, key=lambda x: txs[x]["start"]):
                tx = txs[tid]
                exons = sorted(set(tx["exons"])) or [(tx["start"], tx["end"])]
                cds = tx["cds"]
                cs = min((c[0] for c in cds), default=0)
                ce = max((c[1] for c in cds), default=0)
                tx_list.append((tid, tx["start"], tx["end"], cs, ce, exons))
            out.append(Gene(chrom, gs, ge, strand, name, tx_list))

        # 只有 gene 行、没有转录本的（假基因等）：给一个单外显子占位转录本
        for gid, gm in gene_meta.items():
            if gid in by_gene:
                continue
            out.append(Gene(gm["chrom"], gm["start"], gm["end"], gm["strand"],
                            gm["name"],
                            [(gid, gm["start"], gm["end"], 0, 0,
                              [(gm["start"], gm["end"])])]))

        out.sort(key=lambda gg: (gg.chrom, gg.start))
        return out

    def query(self, chrom, start, end):
        target = self.resolve_chrom(chrom)
        return [g for g in self._genes if g.chrom == target and g.end > start and g.start < end]

    def search_names(self, q: str, limit: int = 30):
        """Case-insensitive gene-name search across the parsed GTF.

        Exact > prefix > substring; returns at most ``limit`` Gene objects.
        An uppercase-name index is built lazily and cached on the track so
        repeat searches (every keystroke) stay cheap even for whole-genome
        GTFs with tens of thousands of genes.
        """
        q = (q or "").strip()
        if not q:
            return []
        up = q.upper()
        idx = getattr(self, "_name_idx", None)
        if idx is None:
            idx = {}
            for g in self._genes:
                idx.setdefault(g.name.upper(), []).append(g)
            self._name_idx = idx
        out: list = list(idx.get(up, []))
        if len(out) < limit:
            for name in idx:
                if name != up and name.startswith(up):
                    out.extend(idx[name])
                    if len(out) >= limit:
                        break
        if len(out) < limit:
            for name in idx:
                if up in name and not name.startswith(up):
                    out.extend(idx[name])
                    if len(out) >= limit:
                        break
        return out[:limit]

    def meta(self):
        m = super().meta()
        m["genes"] = len(self._genes)
        return m


class RepeatTrack(BaseTrack):
    """重复序列注释（RepeatMasker / UCSC rmsk GTF）：**每个拷贝**是一个元件。

    为什么不能当普通 GTF 解析：这类文件的 ``gene_id`` 是**家族名**
    （``AluY`` / ``L1P5`` / ``MIR``），同一个名字在基因组里有成千上万个拷贝，
    只有 ``transcript_id`` 是每个拷贝唯一的 id。按 ``gene_id`` 聚合会把全基因
    组的同名拷贝并成一个横跨整条染色体的假基因 —— 实测 60 万行会变成 1164 个
    「基因」，每个跨 249 Mb、带几千到一万多个转录本，前端根本画不出来。

    存储也换了：483 万个拷贝如果用 ``Gene`` 对象要 2.2 GB，这里按染色体存成
    ``array('I')``（start/end/名字索引 + strand 字节），约 60 MB。
    """

    kind = "gene"
    _CACHE_VER = 1

    def __init__(self, tid, name, path):
        super().__init__(tid, name, path, "gtf")
        self._is_repeat = True
        self._names: list[str] = []
        self._per: dict[str, tuple] = {}
        self._maxlen = 1
        self.n = 0
        self._load_or_parse()
        # 染色体长度取该染色体上最后一个元件的 end（与 BedTrack 一致）
        self.chroms = {c: int(max(v[1])) for c, v in self._per.items() if len(v[1])}

    # --------------------------------------------------------------- 缓存
    def cache_path(self) -> Path:
        return self.path.parent / ".cache" / f"{self._fp()}.repeat.pkl"

    def _fp(self) -> str:
        fp = self.__dict__.get("_fingerprint")
        if fp is None:
            fp = self._fingerprint = _quick_fingerprint(self.path)
        return fp

    def _load_or_parse(self) -> None:
        try:
            cp = self.cache_path()
        except OSError:
            self._parse()
            return
        try:
            with open(cp, "rb") as f:
                blob = pickle.load(f)
            if blob.get("sig") == self._CACHE_VER and isinstance(blob.get("per"), dict):
                self._names = blob["names"]
                self._per = blob["per"]
                self._maxlen = blob["maxlen"]
                self.n = blob["n"]
                try:
                    cp.touch()
                except OSError:
                    pass
                return
        except (OSError, pickle.UnpicklingError, EOFError, AttributeError, ValueError, KeyError):
            pass
        self._parse()
        try:
            cp.parent.mkdir(parents=True, exist_ok=True)
            tmp = cp.with_suffix(".tmp")
            with open(tmp, "wb") as f:
                pickle.dump({"sig": self._CACHE_VER, "names": self._names,
                             "per": self._per, "maxlen": self._maxlen, "n": self.n},
                            f, protocol=4)
            tmp.replace(cp)
            _prune_cache(cp.parent, 6)
        except OSError:
            pass

    # --------------------------------------------------------------- 解析
    def _parse(self) -> None:
        names: list[str] = []
        nidx: dict[str, int] = {}
        starts: dict[str, array] = {}
        ends: dict[str, array] = {}
        nidxs: dict[str, array] = {}
        strands: dict[str, bytearray] = {}
        maxlen = 1
        n = 0
        with _open_text(self.path) as f:
            for line in f:
                if not line or line[0] == "#":
                    continue
                cols = line.split("\t")
                if len(cols) < 9:
                    continue
                try:
                    s = int(cols[3]) - 1     # GTF/GFF3 都是 1-based inclusive
                    e = int(cols[4])
                except ValueError:
                    continue
                if e <= s:
                    continue
                chrom = cols[0]
                attr = cols[8]
                # 显示名：gene_name（GENCODE 的 rmsk 会给重复名加 :TE 后缀）
                nm = _gtf_val(attr, "gene_name") or _gtf_val(attr, "gene_id")
                if nm is None:
                    nm = _gff_val(attr, "Name") or _gff_val(attr, "gene_id") or "repeat"
                if nm.endswith(":TE"):
                    nm = nm[:-3]
                i = nidx.get(nm)
                if i is None:
                    i = nidx[nm] = len(names)
                    names.append(nm)
                starts.setdefault(chrom, array("I")).append(s)
                ends.setdefault(chrom, array("I")).append(e)
                nidxs.setdefault(chrom, array("I")).append(i)
                strands.setdefault(chrom, bytearray()).append(0 if cols[6] != "-" else 1)
                if e - s > maxlen:
                    maxlen = e - s
                n += 1

        per: dict[str, tuple] = {}
        for chrom, sa in starts.items():
            ea, na, ta = ends[chrom], nidxs[chrom], strands[chrom]
            # 文件不保证按坐标排序（rmsk 是乱序输出的），query 要 bisect，必须先排
            rows = sorted(zip(sa, ea, na, ta))
            per[chrom] = (
                array("I", [r[0] for r in rows]),
                array("I", [r[1] for r in rows]),
                array("I", [r[2] for r in rows]),
                bytearray(r[3] for r in rows),
            )
        self._names = names
        self._per = per
        self._maxlen = maxlen
        self.n = n

    # --------------------------------------------------------------- 查询
    def _span(self, c, start, end):
        """[start,end) 内 start 落在窗口的候选下标范围 [lo, hi)。"""
        got = self._per.get(c)
        if not got:
            return None
        starts = got[0]
        hi = bisect.bisect_left(starts, end)
        lo = bisect.bisect_left(starts, start - self._maxlen)
        return lo, hi

    def count_hits(self, chrom, start, end) -> int:
        """窗口内元件数（上界，用 start 落点估算，够 truncated 标记用）。"""
        sp = self._span(self.resolve_chrom(chrom), start, end)
        if sp is None:
            return 0
        return max(0, sp[1] - sp[0])

    def summary(self, chrom, start, end, bins):
        """每 bin 的元件个数 —— 低倍视野下前端画成密度带。

        逐个画元件在整条染色体的视野里必然糊成一片（几千个元件挤在几百个
        像素里），密度带才是这个尺度下唯一有意义的表现。
        """
        c = self.resolve_chrom(chrom)
        sp = self._span(c, start, end)
        if sp is None or bins <= 0:
            return []
        starts = self._per[c][0]
        lo, hi = sp
        span = max(1, end - start)
        counts = [0] * bins
        for j in range(lo, hi):
            k = (starts[j] - start) * bins // span
            if 0 <= k < bins:
                counts[k] += 1
        return counts

    def query(self, chrom, start, end, limit=None):
        """窗口内的元件。

        低倍视野（整条染色体）下窗口里可能有几十万个拷贝，这时按 ``limit``
        **均匀抽样**而不是取前 N 个 —— 取前 N 会全部堆在左边缘，看起来像
        「重复都在染色体开头」。
        """
        c = self.resolve_chrom(chrom)
        got = self._per.get(c)
        sp = self._span(c, start, end)
        if not got or sp is None:
            return []
        starts, ends, nidx, strands = got
        names = self._names
        lo, hi = sp
        stride = 1
        if limit is not None and (hi - lo) > limit:
            stride = (hi - lo) // limit + 1
        out = []
        for j in range(lo, hi, stride):
            if ends[j] <= start:
                continue
            s = starts[j]
            e = ends[j]
            nm = names[nidx[j]]
            out.append(Gene(c, s, e, "-" if strands[j] else "+", nm,
                            [(nm, s, e, 0, 0, [(s, e)])]))
            if limit is not None and len(out) >= limit:
                break
        return out

    def search_names(self, q: str, limit: int = 30):
        """按家族名搜索拷贝（大小写不敏感，exact → prefix → substring）。

        名字只有一两千个，先挑出匹配的名字下标，再用 ``bytes.find`` 在各染色体
        的名字索引数组里定位拷贝 —— 483 万个元素也能做到毫秒级。
        """
        q = (q or "").strip()
        if not q:
            return []
        up = q.upper()
        ups = getattr(self, "_names_up", None)
        if ups is None:
            ups = self._names_up = [x.upper() for x in self._names]
        hit = [i for i, x in enumerate(ups) if x == up]
        if not hit:
            hit = [i for i, x in enumerate(ups) if x.startswith(up)]
        if not hit:
            hit = [i for i, x in enumerate(ups) if up in x]
        if not hit:
            return []
        out: list = []
        for k in hit:
            self._collect_name(k, out, limit)
            if len(out) >= limit:
                break
        return out[:limit]

    def _collect_name(self, k: int, out: list, limit: int) -> None:
        names = self._names
        nm = names[k]
        for chrom, (starts, ends, nidx, strands) in self._per.items():
            if len(out) >= limit:
                return
            if nidx.itemsize == 4 and sys.byteorder == "little":
                blob = nidx.tobytes()
                pat = struct.pack("<I", k)
                pos = blob.find(pat)
                while pos >= 0 and len(out) < limit:
                    j = pos // 4
                    s = starts[j]
                    e = ends[j]
                    out.append(Gene(chrom, s, e, "-" if strands[j] else "+", nm,
                                    [(nm, s, e, 0, 0, [(s, e)])]))
                    pos = blob.find(pat, pos + 4)
            else:                                  # 罕见平台：退化成线性扫描
                for j in range(len(nidx)):
                    if len(out) >= limit:
                        return
                    if nidx[j] == k:
                        s = starts[j]
                        e = ends[j]
                        out.append(Gene(chrom, s, e, "-" if strands[j] else "+", nm,
                                        [(nm, s, e, 0, 0, [(s, e)])]))

    def meta(self):
        m = super().meta()
        m["genes"] = self.n
        m["repeat"] = True
        return m


# --------------------------------------------------------------------------- #
# BED / narrowPeak（区间注释，渲染复用基因轨道那一套）
# --------------------------------------------------------------------------- #
class BedTrack(BaseTrack):
    """BED / narrowPeak / broadPeak。

    每个区间当作「只有一个外显子的基因」交给前端，注释轨道的框、名字、
    正负链箭头、展开明细就都能直接复用（IGV 显示 BED 也是这个样式）。
    BED12 会按 blockSizes/blockStarts 拆成多个外显子，thickStart/thickEnd 当 CDS。

    narrowPeak 是 BED6+4（多出 signalValue/pValue/qValue/peak 四列），
    解析路径与 BED 完全一致，只是那四列暂不参与绘制。
    """

    kind = "gene"

    def __init__(self, tid, name, path, fmt=None):
        # 存盘时保留了原扩展名，所以窄峰/宽峰能从路径反推出来
        # （用 _split_ext 而不是 Path().suffix，否则 x.narrowPeak.gz 会被 .gz 吃掉）
        super().__init__(tid, name, path, fmt or _split_ext(path)[0] or "bed")
        self._genes: dict[str, list] = {}
        self._starts: dict[str, list] = {}
        self._maxlen = 1
        self.n = 0
        self._parse()
        self.chroms = {c: max(g.end for g in lst) for c, lst in self._genes.items()}

    def _parse(self):
        by: dict[str, list] = {}
        maxlen = 1
        with _open_text(self.path) as f:
            for line in f:
                if not line or line[0] == "#":
                    continue
                if line.startswith("track") or line.startswith("browser"):
                    continue
                cols = line.rstrip("\n").split("\t")
                if len(cols) < 3:
                    # 有些工具用空格分隔，兜底再试一次
                    cols = line.split()
                    if len(cols) < 3:
                        continue
                chrom = cols[0]
                try:
                    s, e = int(cols[1]), int(cols[2])
                except ValueError:
                    continue
                if e <= s:
                    continue
                nm = cols[3].strip() if len(cols) > 3 else ""
                if not nm or nm == ".":
                    nm = f"{chrom}:{s + 1:,}-{e:,}"
                strand = cols[5] if len(cols) > 5 and cols[5] in ("+", "-") else "+"
                exons = [(s, e)]
                cs = ce = 0
                if len(cols) >= 12:      # BED12
                    try:
                        thick_s, thick_e = int(cols[6]), int(cols[7])
                        cnt = int(cols[9])
                        sizes = [int(x) for x in cols[10].rstrip(",").split(",") if x]
                        offs = [int(x) for x in cols[11].rstrip(",").split(",") if x]
                    except ValueError:
                        cnt, sizes, offs, thick_s, thick_e = 0, [], [], 0, 0
                    if cnt and len(sizes) >= cnt and len(offs) >= cnt:
                        exons = sorted((s + offs[i], s + offs[i] + sizes[i]) for i in range(cnt))
                        if thick_e > thick_s:
                            cs, ce = thick_s, thick_e
                by.setdefault(chrom, []).append(
                    Gene(chrom, s, e, strand, nm, [(nm, s, e, cs, ce, exons)]))
                if e - s > maxlen:
                    maxlen = e - s
        self.n = sum(len(v) for v in by.values())
        self._maxlen = maxlen
        for c, lst in by.items():
            lst.sort(key=lambda g: g.start)
            self._genes[c] = lst
            self._starts[c] = [g.start for g in lst]

    def query(self, chrom, start, end):
        c = self.resolve_chrom(chrom)
        lst = self._genes.get(c)
        if not lst:
            return []
        starts = self._starts[c]
        i = bisect.bisect_left(starts, end)
        floor = start - self._maxlen
        j = i - 1
        out = []
        while j >= 0 and starts[j] >= floor:
            g = lst[j]
            if g.end > start and g.start < end:
                out.append(g)
            j -= 1
        out.reverse()
        return out

    def search_names(self, q: str, limit: int = 30):
        """Case-insensitive feature-name search (BED names are gene-like)."""
        q = (q or "").strip()
        if not q:
            return []
        up = q.upper()
        idx = getattr(self, "_name_idx", None)
        if idx is None:
            idx = {}
            for lst in self._genes.values():
                for g in lst:
                    idx.setdefault(g.name.upper(), []).append(g)
            self._name_idx = idx
        out: list = list(idx.get(up, []))
        if len(out) < limit:
            for name in idx:
                if name != up and name.startswith(up):
                    out.extend(idx[name])
                    if len(out) >= limit:
                        break
        if len(out) < limit:
            for name in idx:
                if up in name and not name.startswith(up):
                    out.extend(idx[name])
                    if len(out) >= limit:
                        break
        return out[:limit]

    def meta(self):
        m = super().meta()
        m["features"] = self.n
        return m


# --------------------------------------------------------------------------- #
# FASTA
# --------------------------------------------------------------------------- #
class FastaTrack(BaseTrack):
    kind = "seq"

    def __init__(self, tid, name, path):
        super().__init__(tid, name, path, "fasta")
        self._index: dict[str, dict] = {}
        self._fh = self._open_bin()
        self._build_index()
        self.chroms = {k: v["len"] for k, v in self._index.items()}

    def _open_bin(self):
        """普通 FASTA 直接按字节偏移随机读；``.gz`` 无法随机定位，先解压到内存。

        序列轨道的 fetch() 依赖 seek/tell 求偏移，所以 gzip 流不能直接用；
        FASTA 一般只有几 MB，整体解压进内存是最省事的做法。
        """
        try:
            with open(self.path, "rb") as f:
                magic = f.read(2)
        except OSError:
            magic = b""
        if magic == b"\x1f\x8b":
            with gzip.open(self.path, "rb") as g:
                return io.BytesIO(g.read())
        return open(self.path, "rb")

    def _build_index(self) -> None:
        f = self._fh
        f.seek(0)
        cur = None
        line_bases = line_width = None
        length = 0
        while True:
            line = f.readline()
            if not line:
                break
            if line.startswith(b">"):
                if cur is not None:
                    self._index[cur] = {"off": off, "lb": line_bases or 1,
                                        "lw": line_width or (line_bases or 1) + 1, "len": length}
                cur = line[1:].strip().split()[0].decode("utf-8", "replace") if line[1:].strip() else "seq"
                off = f.tell()
                line_bases = line_width = None
                length = 0
            else:
                if line_bases is None:
                    line_bases = len(line.rstrip(b"\r\n"))
                    line_width = len(line)
                length += len(line.rstrip(b"\r\n"))
        if cur is not None:
            self._index[cur] = {"off": off, "lb": line_bases or 1,
                                "lw": line_width or (line_bases or 1) + 1, "len": length}

    def fetch(self, chrom, start, end):
        info = self._index.get(self.resolve_chrom(chrom))
        if info is None:
            return None
        lb, lw = max(1, info["lb"]), max(1, info["lw"])
        end = min(end, info["len"])
        if end <= start:
            return ""
        a = info["off"] + (start // lb) * lw + (start % lb)
        b = info["off"] + (end // lb) * lw + (end % lb)
        f = self._fh
        f.seek(a)
        raw = f.read(max(1, b - a + 2))
        seq = raw.replace(b"\n", b"").replace(b"\r", b"")
        return seq[: end - start].decode("ascii", "replace").upper()

    def meta(self):
        m = super().meta()
        return m


# --------------------------------------------------------------------------- #
# manager
# --------------------------------------------------------------------------- #
def _dir_writable(p: Path) -> bool:
    """目录能不能真正写入（只看有没有写权限不够，还要能建文件）。"""
    try:
        p.mkdir(parents=True, exist_ok=True)
    except OSError:
        return False
    probe = p / f".wtest_{os.getpid()}_{threading.get_ident()}"
    try:
        probe.write_bytes(b"0")
    except OSError:
        return False
    finally:
        try:
            probe.unlink()
        except OSError:
            pass
    return True


def writable_loaded_dir(data_dir: Path) -> Path:
    """导入文件（FA/GTF/BED/BAM…）要落在一个**可写**的目录里。

    安装版把 data/ 放在 exe 旁边（%ProgramFiles%\\Orbit\\data），
    普通用户对那里只有读权限，导入会直接 PermissionError。
    所以：默认的 data/loaded 能写就用它；不能写就退到用户目录：

        Windows : %LOCALAPPDATA%\\Orbit\\loaded
        其它    : $XDG_DATA_HOME/Orbit/loaded 或 ~/.local/share/Orbit/loaded

    内置的基因组/注释/bigWig 仍然只从安装目录读，不受影响。
    """
    cand = Path(data_dir) / "loaded"
    if _dir_writable(cand):
        return cand
    if os.name == "nt":
        root = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        if not root:
            root = str(Path.home() / "AppData" / "Local")
    else:
        root = os.environ.get("XDG_DATA_HOME")
        if not root:
            root = str(Path.home() / ".local" / "share")
    return Path(root) / "Orbit" / "loaded"


class LoadedManager:
    # Session-only imports by default (user preference, 2026-10-31).
    # Keep registrations on disk, but never parse/reopen any format at startup.
    _RESTORE_FORMATS = ()

    def __init__(self, data_dir: Path):
        self.dir = writable_loaded_dir(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._index_path = self.dir / "index.json"
        self._lock = threading.Lock()
        self.tracks: dict[str, BaseTrack] = {}
        # 索引里这次没恢复的条目（见 _RESTORE_FORMATS），写回时原样带上，
        # 免得新增一个文件就把它们的记录冲掉。
        self._kept_index: list[dict] = []
        # Imported tracks are session-only. IGV_RESTORE_LOADED=1 is an explicit
        # developer opt-in; the normal launcher disables it.
        # Explicit opt-in only. Normal launches preserve registrations without
        # opening any previous files or building their indexes.
        if os.environ.get("IGV_RESTORE_LOADED") == "1":
            self._load_index()
        else:
            self._load_index(only_cheap=True)

    # ------------------------------------------------------------- persistence
    def _load_index(self, only_cheap: bool = False) -> None:
        if not self._index_path.exists():
            return
        try:
            meta = json.loads(self._index_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return
        for m in meta:
            if only_cheap and m.get("format") not in self._RESTORE_FORMATS:
                self._kept_index.append(m)
                continue
            fname = m.get("file")
            if not fname:
                continue
            p = self.dir / fname
            if not p.exists():
                continue
            try:
                t = self._make(m["id"], m.get("name") or fname, p, m.get("format"))
                if isinstance(t, SegTrack) and m.get("sample") in t.samples:
                    t._use(m["sample"])
                self.tracks[t.id] = t
            except Exception:  # noqa: BLE001
                continue

    def _save_index(self) -> None:
        # 去重：同一个 (id, file) 只留一条。之前反复导入/恢复会让 index.json 里
        # 堆出同名同文件的重复条目，重启后列表里就出现 xxx 和 xxx_2 两个轨道。
        meta = []
        seen = set()
        for m in self._kept_index:
            key = (m.get("id"), m.get("file"))
            if key in seen:
                continue
            seen.add(key)
            meta.append(m)
        for t in self.tracks.values():
            item = {"id": t.id, "name": t.name, "file": t.path.name,
                    "format": t.format, "kind": t.kind}
            if isinstance(t, SegTrack):
                # 多个样本共用同一个文件，恢复时要记清这条轨道对应哪个样本
                item["sample"] = t.sample
            meta.append(item)
        try:
            self._index_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        except OSError:
            pass

    # ------------------------------------------------------------------- add
    def _make(self, tid, name, path, fmt):
        if fmt in ("bed", "narrowpeak", "broadpeak"):
            return BedTrack(tid, name, path, fmt)
        if fmt == "gtf" and _looks_like_repeat_gtf(path):
            # RepeatMasker 的 gene_id 是家族名，必须逐拷贝建元件（见 RepeatTrack）
            return RepeatTrack(tid, name, path)
        return {
            "bigwig": BigWigSignal,
            "bedgraph": BedGraphSignal,
            "wig": WigSignal,
            "seg": SegTrack,
            "bam": BamSignal,
            "sam": SamSignal,
            "gtf": GtfTrack,
            "fasta": FastaTrack,
        }[fmt](tid, name, path)

    def add_local(self, src: Path) -> list[BaseTrack]:
        """直接挂载本机路径（不复制文件）。

        BAM 动辄几个 GB，走浏览器上传要传一遍、再在 data/loaded 存一份，两个都很慢。
        同盘用硬链接（瞬时、不占空间），跨盘才退回复制。顺带把同名 ``.bai`` 一起挂上，
        有了索引就能按窗口随机访问，不必把整个文件扫进内存。
        """
        src = Path(src).expanduser().resolve()
        if not src.exists():
            raise ValueError(f"文件不存在：{src}")
        fmt, save_ext = _split_ext(src.name)
        if fmt is None and _looks_like_seg(src):
            fmt, save_ext = "seg", ".seg.txt"
        if fmt is None:
            raise ValueError(f"不支持的文件类型：{src.suffix}")
        base = _safe_stem(src.name)
        with self._lock:
            tid = base
            k = 2
            while tid in self.tracks:
                tid = f"{base}_{k}"
                k += 1
            dest = self.dir / f"{tid}{save_ext}"
            same = False
            try:
                same = dest.exists() and (dest.resolve() == src or (dest.exists() and src.exists() and os.path.samefile(dest, src)))
            except OSError:
                same = False
            if not same:
                if dest.exists():
                    try:
                        dest.unlink()
                    except OSError:
                        pass
                if not dest.exists():
                    try:
                        os.link(src, dest)
                    except OSError:
                        shutil.copyfile(src, dest)
            # 索引文件一起挂上（不占空间，且 BamSignal 直接就能用）
            # 索引文件：原目录里的 xxx.bam.bai / xxx.bai / xxx.csi 都自动带过来，
            # 用户不需要额外操作（这也是 IGV 的行为：索引就在 bam 旁边）
            side_cands = [Path(str(src) + ".bai"), Path(str(src) + ".csi")]
            try:
                side_cands += [src.with_suffix(".bai"), src.with_suffix(".csi")]
            except ValueError:
                pass
            for side in side_cands:
                tgt = Path(str(dest) + side.suffix)
                if not side.exists() or tgt.exists():
                    continue
                try:
                    os.link(side, tgt)
                except OSError:
                    try:
                        shutil.copyfile(side, tgt)
                    except Exception:  # noqa: BLE001
                        pass
        try:
            track = self._make(tid, src.name, dest, fmt)
        except Exception:
            try:
                dest.unlink(missing_ok=True)
            except OSError:
                pass
            raise
        with self._lock:
            self.tracks[tid] = track
        self._save_index()
        return [track]

    def add(self, src: Path, orig_name: str) -> list[BaseTrack]:
        fmt, save_ext = _split_ext(orig_name)
        if fmt is None and _looks_like_seg(src):
            # 扩展名是 .txt / .v2.txt 之类时靠表头认出来
            fmt, save_ext = "seg", ".seg.txt"
        if fmt is None:
            ext = Path(orig_name).suffix or "(无扩展名)"
            # .txt / .tsv 没有固定含义，靠表头认成 SEG；认不出来时把话说明白，
            # 否则用户只会看到「不支持 .txt」，却不知道差在哪。
            hint = "（.txt / .tsv 需要是带表头的 SEG 表）" if ext.lower() in (".txt", ".tsv") else ""
            raise ValueError(f"不支持的文件类型：{ext}{hint}")
        base = _safe_stem(orig_name)
        # 同一个文件被重复导入时直接复用已有轨道，不再生成 xxx_2 副本：
        # 否则列表里会出现两行同名轨道、画两张一模一样的热图，用户分不清哪个是哪个。
        # 判据用「原始文件名 + 字节数」，既不读内容也能挡住误拖两次的情况。
        name = Path(orig_name).name
        try:
            size = src.stat().st_size
        except OSError:
            size = -1
        with self._lock:
            for t in self.tracks.values():
                if t.name != name or size < 0:
                    continue
                try:
                    if t.path.stat().st_size == size:
                        return [t]
                except OSError:
                    continue
            tid = base
            k = 2
            while tid in self.tracks:
                tid = f"{base}_{k}"
                k += 1
            dest = self.dir / f"{tid}{save_ext}"
            # 目标文件可能还在：删掉的轨道在 Windows 上常留了残骸（文件被 mmap 占用），
            # 直接 move 覆盖会抛 WinError 1224，整个导入就失败了。能删就删，删不掉就换个名字。
            if dest.exists():
                try:
                    dest.unlink()
                except OSError:
                    k = 2
                    while True:
                        alt_tid = f"{base}_{k}"
                        alt = self.dir / f"{alt_tid}{save_ext}"
                        if alt_tid not in self.tracks and not alt.exists():
                            tid, dest = alt_tid, alt
                            break
                        k += 1
        # 同盘时 shutil.move 走 rename（0 拷贝），跨盘才退化成复制
        if src.stat().st_dev == dest.parent.stat().st_dev:
            shutil.move(str(src), str(dest))
        else:
            shutil.copyfile(src, dest)
            try:
                src.unlink()
            except OSError:
                pass
        try:
            track = self._make(tid, Path(orig_name).name, dest, fmt)
        except Exception:
            # 解析/建索引失败时别把文件留在 data/loaded：它会在下一次同名导入时
            # 变成「目标已存在」的拦路石（Windows 上还可能因为被占用而覆盖失败）
            try:
                dest.unlink(missing_ok=True)
            except OSError:
                pass
            raise
        with self._lock:
            self.tracks[tid] = track
        self._save_index()
        # 返回列表：一个文件将来可能展开成多条轨道（现在只有 SEG 的多样本会用，
        # 但接口先按列表定下来，server/前端就不用再改）
        return [track]

    # ---------------------------------------------------------------- queries
    def get(self, tid: str) -> BaseTrack | None:
        return self.tracks.get(tid)

    def signals(self) -> list[BaseTrack]:
        return [t for t in self.tracks.values() if t.kind == "signal"]

    def gene_tracks(self) -> list[BaseTrack]:
        return [t for t in self.tracks.values() if t.kind == "gene"]

    def seq_tracks(self) -> list[BaseTrack]:
        return [t for t in self.tracks.values() if t.kind == "seq"]

    def metas(self) -> list[dict]:
        return sorted((t.meta() for t in self.tracks.values()), key=lambda m: (m["kind"], m["name"]))

    def remove(self, tid: str) -> bool:
        with self._lock:
            t = self.tracks.pop(tid, None)
        if t is None:
            return False
        # 缓存路径要趁源文件还在时算出来（指纹要读文件），否则删完就找不到了
        cp = None
        if isinstance(t, GtfTrack):
            try:
                cp = t.cache_path()
            except OSError:
                cp = None
        # 多样本 SEG 的几条轨道共用同一个文件：还有人在用时不能删
        if not any(x.path == t.path for x in self.tracks.values()):
            # 先把 mmap / 文件句柄关掉：Windows 上还映射着就 unlink 会失败，
            # 结果文件残留在 data/loaded 里，下次用同名文件重新导入时覆盖不了
            for attr in ("bw", "fa", "ann"):
                obj = getattr(t, attr, None)
                close = getattr(obj, "close", None)
                if callable(close):
                    try:
                        close()
                    except Exception:  # noqa: BLE001
                        pass
            try:
                t.path.unlink(missing_ok=True)
            except OSError:
                pass
        if cp is not None:
            try:
                cp.unlink(missing_ok=True)
            except OSError:
                pass
        self._save_index()
        return True
