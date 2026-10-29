"""Packed binary gene-annotation index (``.igvbin``).

Design goals: one file per assembly, instant random access by locus, no
external index files, no text parsing at load time.

Layout::

    header (64 B)
    chrom table (variable)
    records (variable, sorted by chrom then start)
    rec offsets   u64[nRec]
    rec starts    u32[nRec]
    per-chrom linear bin index  u32[nBins]

Query strategy is the same one tabix uses: a linear index over fixed-size
windows, plus a bounded backward scan covering the longest feature.
"""
from __future__ import annotations

import mmap
import struct
from pathlib import Path

MAGIC = b"IGVANNB1"
VERSION = 1
HEADER = struct.Struct(">8sIIIIQQQQII")  # 64 bytes
CHROM_HDR = struct.Struct(">H")          # nameLen
CHROM_TAIL = struct.Struct(">IIIIQ")     # length, recStart, recCount, nBins, binOffset
NONE = 0xFFFFFFFF


class Gene:
    __slots__ = ("chrom", "start", "end", "strand", "name", "transcripts")

    def __init__(self, chrom, start, end, strand, name, transcripts):
        self.chrom = chrom
        self.start = start
        self.end = end
        self.strand = strand
        self.name = name
        self.transcripts = transcripts

    def to_dict(self):
        return {
            "chrom": self.chrom,
            "start": self.start,
            "end": self.end,
            "strand": self.strand,
            "name": self.name,
            "tx": [
                {"name": t[0], "start": t[1], "end": t[2], "cdsStart": t[3],
                 "cdsEnd": t[4], "exons": t[5]}
                for t in self.transcripts
            ],
        }


def _pack_str(s: str) -> bytes:
    b = s.encode("utf-8")
    if len(b) > 65535:
        b = b[:65535]
    return struct.pack(">H", len(b)) + b


class AnnWriter:
    """Build a .igvbin from parsed records."""

    def __init__(self, bin_shift: int = 14):
        self.bin_shift = bin_shift
        self.records: dict[str, list] = {}
        self.chrom_len: dict[str, int] = {}

    def set_chroms(self, sizes: dict[str, int]) -> None:
        self.chrom_len = dict(sizes)

    def add_gene(self, chrom: str, start: int, end: int, strand: str,
                 name: str, transcripts: list) -> None:
        self.records.setdefault(chrom, []).append(
            (start, end, strand, name, transcripts))
        if chrom not in self.chrom_len:
            self.chrom_len[chrom] = max(end, 1)

    def write(self, path: str | Path) -> dict:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        chroms = sorted(self.chrom_len)
        chrom_id = {c: i for i, c in enumerate(chroms)}

        ordered: list[tuple] = []
        per_chrom_count: dict[str, int] = {}
        for chrom in chroms:
            recs = self.records.get(chrom, [])
            recs.sort(key=lambda r: (r[0], r[1], r[3]))
            per_chrom_count[chrom] = len(recs)
            ordered.extend((chrom,) + r for r in recs)

        max_span = 1
        for rec in ordered:
            span = rec[2] - rec[1]
            if span > max_span:
                max_span = span

        # ---- encode records into memory (they are small: a few MB per genome)
        blob = bytearray()
        offsets = []
        starts = []
        for chrom, start, end, strand, name, txs in ordered:
            offsets.append(len(blob))
            starts.append(start)
            blob += struct.pack(">IIBB", start, end, 0 if strand == "+" else (1 if strand == "-" else 2), len(txs))
            blob += _pack_str(name)
            for tname, tstart, tend, cds_start, cds_end, exons in txs:
                blob += _pack_str(tname)
                blob += struct.pack(">IIIIH", tstart, tend, cds_start, cds_end, len(exons))
                for es, ee in exons:
                    blob += struct.pack(">II", es, ee)

        # ---- per chrom bin index
        n_rec = len(ordered)
        rec_cursor = 0
        bin_blobs = []
        chrom_meta = []
        for chrom in chroms:
            length = self.chrom_len[chrom]
            count = per_chrom_count[chrom]
            n_bins = (length >> self.bin_shift) + 1
            idx = [NONE] * n_bins
            j = rec_cursor
            end = rec_cursor + count
            for b in range(n_bins - 1, -1, -1):
                boundary = b << self.bin_shift
                while j < end and starts[j] < boundary:
                    j += 1
                while j > rec_cursor and starts[j - 1] >= boundary:
                    j -= 1
                idx[b] = j if j < end else NONE
            chrom_meta.append((chrom, length, rec_cursor, count, n_bins))
            bin_blobs.append(struct.pack(f">{n_bins}I", *idx))
            rec_cursor += count

        # ---- header + chrom table
        table = bytearray()
        for chrom, length, rec_start, count, n_bins in chrom_meta:
            nb = chrom.encode("utf-8")
            table += struct.pack(">H", len(nb)) + nb
            table += CHROM_TAIL.pack(length, rec_start, count, n_bins, 0)

        data_offset = HEADER.size + len(table)
        data_offset += (-data_offset) % 8
        rec_off_offset = data_offset + len(blob)
        rec_start_offset = rec_off_offset + 8 * n_rec
        bin_index_offset = rec_start_offset + 4 * n_rec

        # recompute chrom table with real bin offsets
        table = bytearray()
        cursor = bin_index_offset
        for chrom, length, rec_start, count, n_bins in chrom_meta:
            nb = chrom.encode("utf-8")
            table += struct.pack(">H", len(nb)) + nb
            table += CHROM_TAIL.pack(length, rec_start, count, n_bins, cursor)
            cursor += 4 * n_bins
        assert HEADER.size + len(table) <= data_offset

        with path.open("wb") as fh:
            fh.write(HEADER.pack(MAGIC, VERSION, self.bin_shift, len(chroms), n_rec,
                                 data_offset, rec_off_offset, rec_start_offset,
                                 bin_index_offset, max_span, 0))
            fh.write(table)
            fh.write(b"\0" * (data_offset - HEADER.size - len(table)))
            fh.write(blob)
            fh.write(struct.pack(f">{n_rec}Q", *[o + data_offset for o in offsets]) if n_rec else b"")
            fh.write(struct.pack(f">{n_rec}I", *starts) if n_rec else b"")
            for b in bin_blobs:
                fh.write(b)

        return {"chroms": len(chroms), "records": n_rec, "bytes": path.stat().st_size,
                "maxSpan": max_span}


class AnnReader:
    """Memory-mapped reader for .igvbin."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._fh = self.path.open("rb")
        self._mm = mmap.mmap(self._fh.fileno(), 0, access=mmap.ACCESS_READ)
        (magic, version, bin_shift, n_chrom, n_rec, self.data_offset,
         self.rec_off_offset, self.rec_start_offset, self.bin_index_offset,
         self.max_span, _res) = HEADER.unpack_from(self._mm, 0)
        if magic != MAGIC:
            raise ValueError(f"not an igvbin file: {self.path}")
        self.bin_shift = bin_shift
        self.n_rec = n_rec
        self.chroms: dict[str, dict] = {}
        pos = HEADER.size
        for _ in range(n_chrom):
            (name_len,) = struct.unpack_from(">H", self._mm, pos)
            pos += 2
            name = self._mm[pos:pos + name_len].decode("utf-8")
            pos += name_len
            length, rec_start, count, n_bins, bin_off = CHROM_TAIL.unpack_from(self._mm, pos)
            pos += CHROM_TAIL.size
            self.chroms[name] = {"length": length, "start": rec_start,
                                 "count": count, "bins": n_bins, "binOffset": bin_off}

    # ------------------------------------------------------------------ public
    def query(self, chrom: str, start: int, end: int) -> list[Gene]:
        info = self.chroms.get(chrom)
        if not info or info["count"] == 0:
            return []
        shift = self.bin_shift
        bin_id = max(0, start) >> shift
        back = (self.max_span >> shift) + 1
        lo_bin = max(0, bin_id - back)
        if lo_bin >= info["bins"]:
            lo_bin = info["bins"] - 1
        (idx,) = struct.unpack_from(">I", self._mm, info["binOffset"] + 4 * lo_bin)
        if idx == NONE:
            return []
        i = idx
        stop = info["start"] + info["count"]
        out = []
        while i < stop:
            (rec_start,) = struct.unpack_from(">I", self._mm, self.rec_start_offset + 4 * i)
            if rec_start >= end:
                break
            gene = self._read_record(i, chrom)
            if gene.end > start:
                out.append(gene)
            i += 1
        return out

    def get_by_name(self, name: str, limit: int = 50) -> list[Gene]:
        """Exact symbol lookup, case-insensitive (refGene stores upper-case symbols)."""
        want = name.upper()
        hits = []
        for gene in self.iter_all():
            if gene.name.upper() == want:
                hits.append(gene)
                if len(hits) >= limit:
                    break
        return hits

    def find_names(self, prefix: str, limit: int = 40) -> list[Gene]:
        """Case-insensitive prefix / substring search over gene symbols."""
        prefix = prefix.upper()
        exact, pref, sub = [], [], []
        for gene in self.iter_all():
            up = gene.name.upper()
            if up == prefix:
                exact.append(gene)
            elif up.startswith(prefix):
                pref.append(gene)
            elif prefix in up:
                sub.append(gene)
            if len(exact) + len(pref) >= limit:
                break
        return (exact + pref + sub)[:limit]

    def iter_all(self):
        for chrom, info in self.chroms.items():
            for i in range(info["start"], info["start"] + info["count"]):
                yield self._read_record(i, chrom)

    def count(self) -> int:
        return self.n_rec

    # ------------------------------------------------------------------ intern
    def _read_record(self, i: int, chrom: str) -> Gene:
        mm = self._mm
        (off,) = struct.unpack_from(">Q", mm, self.rec_off_offset + 8 * i)
        start, end, strand_code, n_tx = struct.unpack_from(">IIBB", mm, off)
        off += 10
        (nl,) = struct.unpack_from(">H", mm, off)
        off += 2
        name = mm[off:off + nl].decode("utf-8")
        off += nl
        txs = []
        for _ in range(n_tx):
            (tnl,) = struct.unpack_from(">H", mm, off)
            off += 2
            tname = mm[off:off + tnl].decode("utf-8")
            off += tnl
            tstart, tend, cds_start, cds_end, n_exon = struct.unpack_from(">IIIIH", mm, off)
            off += 18
            exons = []
            for _e in range(n_exon):
                es, ee = struct.unpack_from(">II", mm, off)
                off += 8
                exons.append([es, ee])
            txs.append((tname, tstart, tend, cds_start, cds_end, exons))
        strand = "+" if strand_code == 0 else ("-" if strand_code == 1 else ".")
        return Gene(chrom, start, end, strand, name, txs)

    def close(self) -> None:
        try:
            self._mm.close()
        finally:
            self._fh.close()
