"""bigWig reader (pure standard library).

Implements the parts of the UCSC bigWig format needed by a browser:

* header + zoom level table
* chromosome B+ tree  (chrom id <-> name)
* cirTree R-tree index (which data blocks overlap a query)
* zlib compressed data sections (bedGraph / variableStep / fixedStep)
* zoom level summaries for wide windows
* total summary for global auto-scaling

Everything is memory mapped, so opening a 40 MB track is instant and a
region query only touches the blocks that overlap it.
"""
from __future__ import annotations

import mmap
import struct
import zlib
from pathlib import Path

BIGWIG_MAGIC = 0x888FFC26
BPT_MAGIC = 0x78CA8C91
CIRTREE_MAGIC = 0x2468ACE0


class BigWigError(RuntimeError):
    pass


class BigWig:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._fh = self.path.open("rb")
        self._mm = mmap.mmap(self._fh.fileno(), 0, access=mmap.ACCESS_READ)
        mm = self._mm
        raw = mm[0:4]
        if struct.unpack("<I", raw)[0] == BIGWIG_MAGIC:
            self.e = "<"
        elif struct.unpack(">I", raw)[0] == BIGWIG_MAGIC:
            self.e = ">"
        else:
            raise BigWigError(f"not a bigWig file: {self.path}")

        (self.version, self.zoom_levels, self.chrom_tree_offset,
         self.full_data_offset, self.full_index_offset, self.field_count,
         self.defined_field_count, self.autosql_offset, self.summary_offset,
         self.uncompress_buf_size, self.reserved) = struct.unpack_from(
            f"{self.e}HHQQQHHQQIQ", mm, 4)

        self.zooms = []
        pos = 4 + struct.calcsize(f"{self.e}HHQQQHHQQIQ")
        for _ in range(self.zoom_levels):
            reduction, _res, data_off, index_off = struct.unpack_from(f"{self.e}IIQQ", mm, pos)
            pos += 24
            self.zooms.append({"reduction": reduction, "data": data_off, "index": index_off})

        self.chroms: dict[str, int] = {}
        self.chrom_ids: dict[int, str] = {}
        self.name_to_id: dict[str, int] = {}
        self._read_chrom_tree()

        self._zoom_layout: str | None = None
        self.total = None
        if self.summary_offset:
            bases, mn, mx, total, sq = struct.unpack_from(f"{self.e}Qdddd", mm, self.summary_offset)
            self.total = {"bases": bases, "min": mn, "max": mx, "sum": total}

    # ------------------------------------------------------------------ index
    def _read_chrom_tree(self) -> None:
        mm = self._mm
        magic, block_size, key_size, val_size, item_count, _res = struct.unpack_from(
            f"{self.e}IIIIQQ", mm, self.chrom_tree_offset)
        if magic != BPT_MAGIC:
            raise BigWigError("bad chromosome B+ tree magic")
        stack = [self.chrom_tree_offset + 32]
        guard = 0
        while stack and guard < 1_000_000:
            guard += 1
            pos = stack.pop()
            is_leaf, _r, count = struct.unpack_from(f"{self.e}BBH", mm, pos)
            pos += 4
            if is_leaf:
                for _ in range(count):
                    key = mm[pos:pos + key_size].split(b"\0")[0].decode()
                    pos += key_size
                    chrom_id, chrom_size = struct.unpack_from(f"{self.e}II", mm, pos)
                    pos += val_size
                    self.chroms[key] = chrom_size
                    self.chrom_ids[chrom_id] = key
                    self.name_to_id[key] = chrom_id
            else:
                children = []
                for _ in range(count):
                    pos += key_size
                    (child,) = struct.unpack_from(f"{self.e}Q", mm, pos)
                    pos += 8
                    children.append(child)
                stack.extend(reversed(children))

    def _blocks(self, index_offset: int, chrom_id: int, start: int, end: int) -> list[tuple[int, int]]:
        mm = self._mm
        (magic,) = struct.unpack_from(f"{self.e}I", mm, index_offset)
        if magic != CIRTREE_MAGIC:
            return []
        block_size, item_count, sc, sb, ec, eb, end_file, items_per_slot, _res = struct.unpack_from(
            f"{self.e}IQIIIIQII", mm, index_offset + 4)
        out: list[tuple[int, int]] = []
        stack = [index_offset + 48]
        guard = 0
        while stack and guard < 200_000:
            guard += 1
            pos = stack.pop()
            is_leaf, _r, count = struct.unpack_from(f"{self.e}BBH", mm, pos)
            pos += 4
            for _ in range(count):
                nsc, nsb, nec, neb = struct.unpack_from(f"{self.e}IIII", mm, pos)
                pos += 16
                if is_leaf:
                    data_off, data_size = struct.unpack_from(f"{self.e}QQ", mm, pos)
                    pos += 16
                    if _overlaps(nsc, nsb, nec, neb, chrom_id, start, end):
                        out.append((data_off, data_size))
                else:
                    (child,) = struct.unpack_from(f"{self.e}Q", mm, pos)
                    pos += 8
                    if _overlaps(nsc, nsb, nec, neb, chrom_id, start, end):
                        stack.append(child)
        return out

    # ------------------------------------------------------------------ query
    def intervals(self, chrom: str, start: int, end: int, limit: int = 400_000):
        """Raw intervals [(start, end, value), ...] overlapping the window."""
        if chrom not in self.chroms:
            return []
        cid = self.name_to_id.get(chrom)
        if cid is None:
            return []
        end = min(end, self.chroms[chrom])
        out: list[tuple[int, int, float]] = []
        for data_off, data_size in self._blocks(self.full_index_offset, cid, start, end):
            for iv in self._read_data(data_off, data_size):
                if iv[0] >= end:
                    continue
                if iv[1] <= start:
                    continue
                out.append(iv)
                if len(out) > limit:
                    return out
        out.sort()
        return out

    def summary(self, chrom: str, start: int, end: int, bins: int):
        """Per-bin summaries [{'mean','max'}...] using zoom levels when useful."""
        if chrom not in self.chroms:
            return []
        span = end - start
        if span <= 0 or bins <= 0:
            return []
        cid = self.name_to_id.get(chrom)
        if cid is None:
            return []
        per_bin = span / bins

        # use a zoom level only when a bin spans at least ~half a record,
        # otherwise the raw intervals are both more accurate and still cheap
        zoom = None
        if self.zooms and per_bin >= self.zooms[0]["reduction"] * 0.5:
            for z in self.zooms:
                if z["reduction"] <= per_bin * 2:
                    zoom = z

        sums = [0.0] * bins
        maxs = [0.0] * bins
        counts = [0] * bins

        if zoom:
            for data_off, data_size in self._blocks(zoom["index"], cid, start, end):
                for (s, e, valid, _mn, mx, total, _sq) in self._read_zoom(data_off, data_size):
                    if e <= start or s >= end:
                        continue
                    b0 = int((s - start) / per_bin)
                    b1 = int((min(e, end) - start - 1) / per_bin)
                    for b in range(max(0, b0), min(bins - 1, b1) + 1):
                        # apportion the zoom record over the bins it touches
                        bs = max(s, start + b * per_bin)
                        be = min(e, start + (b + 1) * per_bin)
                        frac = (be - bs) / max(1.0, e - s)
                        sums[b] += total * frac
                        counts[b] += valid * frac
                        if mx > maxs[b]:
                            maxs[b] = mx
        else:
            for (s, e, v) in self.intervals(chrom, start, end):
                b0 = int((s - start) / per_bin)
                b1 = int((min(e, end) - start - 1) / per_bin)
                for b in range(max(0, b0), min(bins - 1, b1) + 1):
                    bs = max(s, start + b * per_bin)
                    be = min(e, start + (b + 1) * per_bin)
                    w = be - bs
                    sums[b] += v * w
                    counts[b] += w
                    if v > maxs[b]:
                        maxs[b] = v

        out = []
        for b in range(bins):
            if counts[b] > 0:
                out.append({"m": round(sums[b] / counts[b], 3), "x": round(maxs[b], 3)})
            else:
                out.append(None)
        return out

    # ------------------------------------------------------------------ decode
    def _decompress(self, data_off: int, data_size: int) -> bytes:
        raw = self._mm[data_off:data_off + data_size]
        if self.uncompress_buf_size > 0:
            try:
                return zlib.decompress(raw)
            except zlib.error as exc:  # pragma: no cover
                raise BigWigError(f"zlib: {exc}") from None
        return raw

    def _sections(self, data_off: int, data_size: int):
        buf = self._decompress(data_off, data_size)
        pos = 0
        n = len(buf)
        e = self.e
        while pos + 24 <= n:
            chrom_id, chrom_start, chrom_end, item_step, item_span, itype, _res, item_count = \
                struct.unpack_from(f"{e}IIIIIBBH", buf, pos)
            pos += 24
            yield chrom_id, chrom_start, chrom_end, item_step, item_span, itype, item_count, buf, pos
            if itype == 1:
                pos += 12 * item_count
            elif itype == 2:
                pos += 8 * item_count
            elif itype == 3:
                pos += 4 * item_count
            else:
                break

    def _read_data(self, data_off: int, data_size: int):
        e = self.e
        for chrom_id, chrom_start, _ce, item_step, item_span, itype, count, buf, pos in \
                self._sections(data_off, data_size):
            if itype == 1:
                for i in range(count):
                    s, en, v = struct.unpack_from(f"{e}IIf", buf, pos + 12 * i)
                    yield (s, en, v)
            elif itype == 2:
                for i in range(count):
                    s, v = struct.unpack_from(f"{e}If", buf, pos + 8 * i)
                    yield (s, s + item_span, v)
            elif itype == 3:
                for i in range(count):
                    (v,) = struct.unpack_from(f"{e}f", buf, pos + 4 * i)
                    s = chrom_start + i * item_step
                    yield (s, s + item_span, v)

    def _read_zoom(self, data_off: int, data_size: int):
        """Yield (start, end, validCount, min, max, sum, sumSquares) records.

        Most writers emit a standard 24 byte section header followed by 32 byte
        summary records.  A few (libBigWig builds used by deepTools among them)
        drop the header and store ``chromId`` + fixed stride records instead, so
        the layout is detected once per file and cached.
        """
        buf = self._decompress(data_off, data_size)
        e = self.e
        if self._zoom_layout is None:
            self._zoom_layout = self._detect_zoom_layout(buf)
        if self._zoom_layout == "section":
            pos = 0
            n = len(buf)
            while pos + 24 <= n:
                _cid, _cs, _ce, _step, _span, itype, _res, count = struct.unpack_from(
                    f"{e}IIIIIBBH", buf, pos)
                pos += 24
                if itype == 1:
                    for i in range(count):
                        yield struct.unpack_from(f"{e}IIIIffff", buf, pos + 32 * i)
                    pos += 32 * count
                elif itype == 2:
                    pos += 8 * count
                elif itype == 3:
                    pos += 4 * count
                else:
                    break
        else:
            # chromId(u32) + 32 byte records, trailing bytes ignored
            pos = 4
            prev = -1
            n = len(buf)
            while pos + 32 <= n:
                s, en, valid = struct.unpack_from(f"{e}III", buf, pos)
                if en <= s or s < prev:
                    break
                mn, mx, total, sq = struct.unpack_from(f"{e}ffff", buf, pos + 12)
                yield (s, en, valid, mn, mx, total, sq)
                prev = en
                pos += 32

    def _detect_zoom_layout(self, buf: bytes) -> str:
        e = self.e
        if len(buf) >= 24:
            _cid, _cs, _ce, _step, _span, itype, _res, count = struct.unpack_from(
                f"{e}IIIIIBBH", buf, 0)
            if itype in (1, 2, 3) and count > 0 and 24 + count * 32 <= len(buf):
                return "section"
        return "records"

    def close(self) -> None:
        try:
            self._mm.close()
        finally:
            self._fh.close()

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:  # noqa: BLE001
            pass


def _overlaps(a_sc, a_sb, a_ec, a_eb, chrom_id, start, end) -> bool:
    """Does R-tree box [a_sc:a_sb, a_ec:a_eb] overlap chrom_id:[start,end)?"""
    if chrom_id < a_sc or chrom_id > a_ec:
        return False
    if chrom_id == a_sc and end <= a_sb:
        return False
    if chrom_id == a_ec and start >= a_eb:
        return False
    return True
