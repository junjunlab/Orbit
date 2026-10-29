"""User-loaded tracks: bigWig / bedGraph / BAM / GTF / FASTA.

These are the common IGV file types that are not part of the bundled build.
Only the Python standard library is used; BAM files are read through ``gzip``,
which transparently concatenates the individual BGZF members.

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
    ".bam": "bam",
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
        self._iv = {c: _Intervals(v) for c, v in data.items()}
        self.chroms = {c: max(e for _, e, _ in v) for c, v in data.items()}
        mx = max((v for arr in data.values() for _, _, v in arr), default=0.0)
        self.total = {"max": mx}

    def summary(self, chrom, start, end, bins):
        it = self._iv.get(self.resolve_chrom(chrom))
        if it is None:
            return []
        return _bin_summary(it.overlapping(start, end), start, end, bins)


# CIGAR op codes that consume the reference
_CIGAR_REF = {0, 2, 3, 7, 8}
_CIGAR_OPS = "MIDNSHP=X"
# 预编译 struct：BAM 记录头固定 32 字节，前 16 字节含 refID/pos/name_len/mapq/bin/n_cigar/flag
_REC_HDR = struct.Struct("<iiBBHHH")
_I32 = struct.Struct("<i")
_U32 = struct.Struct("<I")


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


def _mismatches(rec, refseq):
    """read 碱基 vs 参考，返回 [[相对起点的参考偏移, 碱基], ...]。

    只报 SNV（M/=/X 段内的单碱基替换）；插入/缺失由 CIGAR 交给前端画。
    """
    out = []
    qi = 0
    ri = 0
    seq = rec["seq"].upper()
    rl = len(refseq)
    sl = len(seq)
    for ln, op in rec["ops"]:
        if op in (0, 7, 8):
            for k in range(ln):
                if ri + k >= rl or qi + k >= sl:
                    break
                b = seq[qi + k]
                if b != refseq[ri + k].upper() and b != "N":
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
    def __init__(self, tid, name, path, max_reads: int = 6_000_000):
        super().__init__(tid, name, path, "bam")
        self._iv: dict[str, _Intervals] = {}
        # 每条比对记录在压缩流里的虚拟偏移，下标与 _iv[chrom] 一一对应
        self._voff: dict[str, array] = {}
        self.truncated = False
        self.n_reads = 0
        self.has_seq = False
        self.paired = False
        self._load(max_reads)

    def _load(self, max_reads: int) -> None:
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
                v = st.buf_v + pos
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
                arr = voff.get(chrom)
                if arr is None:
                    arr = voff[chrom] = array("Q")
                    raw[chrom] = []
                raw[chrom].append((pos, refend))
                arr.append(v)
                n += 1
                if n >= max_reads:
                    self.truncated = True
                    break
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
        it = self._iv.get(self.resolve_chrom(chrom))
        if it is None:
            return []
        return _coverage_summary(it.overlapping(start, end), start, end, bins)

    def has_reads(self, chrom):
        """该染色体是否有任何比对记录（BAM 头里声明 ≠ 实际有数据）。"""
        return self.resolve_chrom(chrom) in self._iv

    # ---- 比对视图（IGV 的 reads 堆叠） --------------------------------
    def reads(self, chrom, start, end, max_n=200, ref=None):
        """取回窗口内的原始比对记录，供前端画 reads 堆叠。

        返回 (reads, total, sampled)。``ref`` 是参考序列获取函数
        ``ref(chrom, s, e) -> str|None``，用来算错配；没有序列的 BAM
        （SEQ 为 ``*``）会跳过这一步，只画灰块。
        """
        c = self.resolve_chrom(chrom)
        it = self._iv.get(c)
        voffs = self._voff.get(c)
        if it is None or not voffs:
            return [], 0, False
        idxs = it.overlapping_idx(start, end)
        total = len(idxs)
        sampled = total > max_n
        if sampled:
            # 等距抽样：均匀铺满整个窗口，而不是只画最左边一坨
            step = total / max_n
            idxs = [idxs[int(i * step)] for i in range(max_n)]
        out = []
        st = _BgzfStream(self.path)
        try:
            for i in idxs:
                blk = st.read_record(voffs[i])
                if blk is None:
                    continue
                rec = _decode_read(blk)
                if rec is None:
                    continue
                if rec["lseq"] and ref is not None:
                    try:
                        rs = ref(chrom, rec["p"], rec["e"])
                    except Exception:
                        rs = None
                    if rs:
                        rec["mm"] = _mismatches(rec, rs)
                out.append({"p": rec["p"], "e": rec["e"], "q": rec["q"],
                            "f": rec["f"], "n": rec["n"], "c": rec["c"],
                            "mm": rec["mm"]})
        finally:
            st.close()
        return out, total, sampled

    def meta(self):
        m = super().meta()
        m["reads"] = self.n_reads
        m["truncated"] = self.truncated
        m["hasSeq"] = self.has_seq
        m["paired"] = self.paired
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


def _split_ext(name: str):
    """文件名 → (格式键, 保存用扩展名)。``x.gtf.gz`` → ``('gtf', '.gtf.gz')``"""
    low = Path(name).name.lower()
    comp = ""
    if low.endswith(".gz"):
        comp, low = ".gz", low[:-3]
    elif low.endswith(".bgz"):
        comp, low = ".bgz", low[:-4]
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

                gid = _gtf_val(attr, "gene_id")
                if gid is not None:
                    gn = _gtf_val(attr, "gene_name")
                    txid = _gtf_val(attr, "transcript_id")
                else:
                    a = _parse_attrs(attr)
                    gid = a.get("gene_id") or a.get("gene") or a.get("ID") or a.get("Parent")
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
    def __init__(self, data_dir: Path):
        self.dir = writable_loaded_dir(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._index_path = self.dir / "index.json"
        self._lock = threading.Lock()
        self.tracks: dict[str, BaseTrack] = {}
        # 导入的轨道默认是「会话级」的：重启时不恢复上次的导入。
        # 原因：大文件（1.5 GB GTF / 70 MB BAM）会在开浏览器之前被同步解析
        # （BAM 逐条建区间约 8 s、GTF 反序列化约 0.8 s），导致启动要等好几秒；
        # 而且用户期望每次启动轨道列表都是空的。
        # 需要恢复旧的「记住导入」行为时，设置环境变量 IGV_RESTORE_LOADED=1。
        if os.environ.get("IGV_RESTORE_LOADED") == "1":
            self._load_index()

    # ------------------------------------------------------------- persistence
    def _load_index(self) -> None:
        if not self._index_path.exists():
            return
        try:
            meta = json.loads(self._index_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return
        for m in meta:
            fname = m.get("file")
            if not fname:
                continue
            p = self.dir / fname
            if not p.exists():
                continue
            try:
                t = self._make(m["id"], m.get("name") or fname, p, m.get("format"))
                self.tracks[t.id] = t
            except Exception:  # noqa: BLE001
                continue

    def _save_index(self) -> None:
        meta = []
        for t in self.tracks.values():
            meta.append({"id": t.id, "name": t.name, "file": t.path.name,
                         "format": t.format, "kind": t.kind})
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
            "bam": BamSignal,
            "gtf": GtfTrack,
            "fasta": FastaTrack,
        }[fmt](tid, name, path)

    def add(self, src: Path, orig_name: str) -> BaseTrack:
        fmt, save_ext = _split_ext(orig_name)
        if fmt is None:
            raise ValueError(f"不支持的文件类型：{Path(orig_name).suffix or '(无扩展名)'}")
        base = _safe_stem(orig_name)
        with self._lock:
            tid = base
            k = 2
            while tid in self.tracks:
                tid = f"{base}_{k}"
                k += 1
            dest = self.dir / f"{tid}{save_ext}"
        # 同盘时 shutil.move 走 rename（0 拷贝），跨盘才退化成复制
        if src.stat().st_dev == dest.parent.stat().st_dev:
            shutil.move(str(src), str(dest))
        else:
            shutil.copyfile(src, dest)
            try:
                src.unlink()
            except OSError:
                pass
        track = self._make(tid, Path(orig_name).name, dest, fmt)
        with self._lock:
            self.tracks[tid] = track
        self._save_index()
        return track

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
