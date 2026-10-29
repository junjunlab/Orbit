"""UCSC 2bit genome reader.

The .2bit format is UCSC's native packed binary genome format: two bits per
base, plus run-length blocks for N regions and soft-masked regions.  A whole
human genome fits in ~800 MB and any region can be fetched with a single
seek, which is exactly what a local genome browser needs.

Layout (all integers big-endian):

    header   : signature 0x1A412743, version, sequenceCount, reserved
    index    : per sequence -> nameSize(u8), name, offset(u32)
    sequence : dnaSize(u32), nBlockCount(u32), nBlockStarts[], nBlockSizes[],
               maskBlockCount(u32), maskBlockStarts[], maskBlockSizes[],
               reserved(u32), packedDna[]
"""
from __future__ import annotations

import http.client
import mmap
import struct
import threading
import time
import urllib.parse
from pathlib import Path

SIGNATURE = 0x1A412743
BASES = "TCAG"  # 2-bit code -> base

# lookup table: one packed byte -> four bases
_PACK_LUT = [
    (BASES[(b >> 6) & 3] + BASES[(b >> 4) & 3] + BASES[(b >> 2) & 3] + BASES[b & 3]).encode()
    for b in range(256)
]


class TwoBitError(RuntimeError):
    pass


class TwoBitFile:
    """Random-access reader over a .2bit file (memory mapped, thread safe)."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._fh = self.path.open("rb")
        try:
            self._mm = mmap.mmap(self._fh.fileno(), 0, access=mmap.ACCESS_READ)
        except ValueError:
            self._fh.close()
            raise TwoBitError(f"empty 2bit file: {self.path}") from None
        if len(self._mm) < 16:
            self.close()
            raise TwoBitError(f"truncated 2bit file: {self.path}")
        sig, version, count, _ = struct.unpack_from(">IIII", self._mm, 0)
        if sig != SIGNATURE:
            self.close()
            raise TwoBitError(f"bad 2bit signature in {self.path}")
        self.version = version
        self._index: dict[str, tuple[int, int]] = {}
        pos = 16
        for _ in range(count):
            name_size = self._mm[pos]
            pos += 1
            name = self._mm[pos:pos + name_size].decode("latin-1")
            pos += name_size
            (offset,) = struct.unpack_from(">I", self._mm, pos)
            pos += 4
            (dna_size,) = struct.unpack_from(">I", self._mm, offset)
            self._index[name] = (offset, dna_size)
        self.sequence_names = list(self._index)

    # ------------------------------------------------------------------ public
    def chroms(self) -> dict[str, int]:
        return {name: self._index[name][1] for name in self.sequence_names}

    def __contains__(self, chrom: str) -> bool:
        return chrom in self._index

    def size(self, chrom: str) -> int:
        return self._index[chrom][1]

    def _blocks(self, offset: int) -> tuple[int, tuple, tuple, tuple, tuple]:
        mm = self._mm
        pos = offset + 4
        (n_count,) = struct.unpack_from(">I", mm, pos)
        pos += 4
        n_starts = struct.unpack_from(f">{n_count}I", mm, pos) if n_count else ()
        pos += 4 * n_count
        n_sizes = struct.unpack_from(f">{n_count}I", mm, pos) if n_count else ()
        pos += 4 * n_count
        (m_count,) = struct.unpack_from(">I", mm, pos)
        pos += 4
        m_starts = struct.unpack_from(f">{m_count}I", mm, pos) if m_count else ()
        pos += 4 * m_count
        m_sizes = struct.unpack_from(f">{m_count}I", mm, pos) if m_count else ()
        pos += 4 * m_count
        return pos + 4, n_starts, n_sizes, m_starts, m_sizes

    def fetch(self, chrom: str, start: int, end: int) -> str:
        """Return sequence for [start, end), upper case, clipped to the chrom."""
        if chrom not in self._index:
            raise KeyError(chrom)
        offset, dna_size = self._index[chrom]
        start = max(0, int(start))
        end = min(int(end), dna_size)
        if end <= start:
            return ""
        packed_start, n_starts, n_sizes, _ms, _mz = self._blocks(offset)
        first_byte = start >> 2
        nbytes = ((end - 1) >> 2) - first_byte + 1
        raw = self._mm[packed_start + first_byte: packed_start + first_byte + nbytes]
        buf = b"".join(_PACK_LUT[b] for b in raw)
        begin = start - (first_byte << 2)
        seq = bytearray(buf[begin: begin + (end - start)])
        for s, size in zip(n_starts, n_sizes):
            e = s + size
            if e <= start or s >= end:
                continue
            a = max(s, start) - start
            b = min(e, end) - start
            seq[a:b] = b"N" * (b - a)
        return seq.decode("ascii")

    def n_runs(self, chrom: str) -> list[tuple[int, int]]:
        offset, _ = self._index[chrom]
        _ps, n_starts, n_sizes, _ms, _mz = self._blocks(offset)
        return list(zip(n_starts, n_sizes))

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


# --------------------------------------------------------------------------- #
# remote 2bit over HTTP Range  (IGV-style: read only the bytes for a window)
# --------------------------------------------------------------------------- #
class _HttpRangeReader:
    """Fetch byte ranges from an HTTP(S) URL over a persistent connection.

    Every read becomes a ``Range: bytes=start-end`` request, so we only ever
    pull the bytes covering the requested window -- never the whole file.  The
    connection is kept alive between requests (reconnecting on failure), which
    is what makes interactive browsing fast enough.
    """

    def __init__(self, url: str, timeout: float = 30.0, retries: int = 4,
                 max_entries: int = 2048, max_bytes: int = 96 << 20,
                 max_conns: int = 4):
        self.url = url
        self.timeout = timeout
        self.retries = retries
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        u = urllib.parse.urlsplit(url)
        self._https = (u.scheme == "https")
        self._host = u.hostname
        self._port = u.port
        self._path = u.path + (("?" + u.query) if u.query else "")
        # A small pool lets independent range reads overlap their round-trips.
        # A single connection serialised every read, which is what made remote
        # GC/sequence feel frozen (tens of sequential RTTs per request).
        self.max_conns = max(1, int(max_conns))
        self._free: list = []
        self._pool_lock = threading.Lock()
        self._cache: dict[tuple[int, int], bytes] = {}
        self._bytes = 0
        self._lock = threading.Lock()

    def read(self, start: int, size: int) -> bytes:
        if size <= 0:
            return b""
        start = max(0, int(start))
        key = (start, int(size))
        with self._lock:
            hit = self._cache.get(key)
        if hit is not None:
            return hit
        data = self._fetch(start, int(size))
        with self._lock:
            if key not in self._cache:
                while self._cache and (len(self._cache) >= self.max_entries
                                       or self._bytes + len(data) > self.max_bytes):
                    k0 = next(iter(self._cache))
                    self._bytes -= len(self._cache.pop(k0))
                self._cache[key] = data
                self._bytes += len(data)
        return data

    def _new_conn(self):
        cls = (http.client.HTTPSConnection if self._https
               else http.client.HTTPConnection)
        return cls(self._host, self._port, timeout=self.timeout)

    def _acquire(self):
        with self._pool_lock:
            if self._free:
                return self._free.pop()
        return self._new_conn()

    def _release(self, conn, reusable: bool) -> None:
        if reusable:
            with self._pool_lock:
                if len(self._free) < self.max_conns:
                    self._free.append(conn)
                    return
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass

    def _close_conn(self) -> None:
        """Close every pooled connection (kept for the existing call sites)."""
        with self._pool_lock:
            conns, self._free = self._free, []
        for c in conns:
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass

    def _request(self, conn, start: int, size: int) -> bytes:
        end = start + size - 1
        conn.request("GET", self._path, headers={
            "Range": f"bytes={start}-{end}",
            "User-Agent": "Orbit/1.0 (+igvlocal)",
            "Accept-Encoding": "identity",
        })
        resp = conn.getresponse()
        status = resp.status
        if status == 206:
            data = resp.read()
            if len(data) != size:
                raise TwoBitError(f"short range read {len(data)}/{size} @ {start}")
            return data
        resp.read()
        if status == 200:
            raise TwoBitError("server ignored Range request (HTTP 200); "
                              "this host cannot serve remote 2bit")
        raise TwoBitError(f"HTTP {status} for range {start}-{end}")

    def _fetch(self, start: int, size: int) -> bytes:
        last: Exception | None = None
        for attempt in range(self.retries):
            conn = self._acquire()
            try:
                data = self._request(conn, start, size)
                self._release(conn, True)
                return data
            except TwoBitError:
                self._release(conn, False)
                raise
            except Exception as exc:  # noqa: BLE001
                last = exc
                self._release(conn, False)
            time.sleep(0.4 * (attempt + 1))
        raise TwoBitError(f"range fetch failed {start}-{size + start - 1}: {last}")

    def close(self) -> None:
        self._close_conn()



class _RangeBuffer:
    """Sequential reader over a remote file, backed by chunked range reads."""

    def __init__(self, reader: _HttpRangeReader, pos: int, chunk: int = 1 << 16):
        self._r = reader
        self._base = pos
        self._buf = b""
        self._i = 0
        self._chunk = chunk

    def _ensure(self, need: int) -> None:
        while len(self._buf) - self._i < need:
            more = self._r.read(self._base + len(self._buf), self._chunk)
            if not more:
                raise TwoBitError("unexpected EOF while reading 2bit index")
            self._buf += more

    def u8(self) -> int:
        self._ensure(1)
        v = self._buf[self._i]
        self._i += 1
        return v

    def take(self, n: int) -> bytes:
        self._ensure(n)
        v = self._buf[self._i:self._i + n]
        self._i += n
        return v

    def uint(self) -> int:
        return struct.unpack(">I", self.take(4))[0]


class RemoteTwoBitFile:
    """Read a .2bit genome hosted over HTTP, fetching only the requested window.

    Mirrors :class:`TwoBitFile`'s public API (``fetch`` / ``size`` / ``chroms``)
    so the server can swap between local and remote transparently.  The header
    and sequence index are read once at construction; per-chromosome block
    metadata and packed bases are fetched lazily with HTTP Range requests and
    cached, so panning/zooming a region does not re-download it.
    """

    def __init__(self, url: str, timeout: float = 30.0):
        self.url = url
        self._r = _HttpRangeReader(url, timeout=timeout)
        self._lock = threading.Lock()
        self._meta: dict[str, dict] = {}

        head = self._r.read(0, 16)
        if len(head) < 16:
            raise TwoBitError(f"truncated remote 2bit: {url}")
        if struct.unpack_from(">I", head, 0)[0] == SIGNATURE:
            self._e = ">"
        elif struct.unpack_from("<I", head, 0)[0] == SIGNATURE:
            self._e = "<"
        else:
            raise TwoBitError(f"bad remote 2bit signature: {url}")
        _, self.version, count, _ = struct.unpack_from(self._e + "IIII", head, 0)

        # read the sequence index (name -> file offset), chunked so we do a
        # handful of range requests rather than one per sequence
        rb = _RangeBuffer(self._r, 16)
        index: dict[str, int] = {}
        for _ in range(count):
            name_len = rb.u8()
            name = rb.take(name_len).decode("latin-1")
            (offset,) = struct.unpack(self._e + "I", rb.take(4))
            index[name] = offset
        self._index = index
        self.sequence_names = list(index)

    # ------------------------------------------------------------------ public
    def __contains__(self, chrom: str) -> bool:
        return chrom in self._index

    def _load_meta(self, chrom: str) -> dict:
        with self._lock:
            if chrom in self._meta:
                return self._meta[chrom]
        if chrom not in self._index:
            raise KeyError(chrom)
        e = self._e
        off = self._index[chrom]
        # dna_size + nBlockCount
        dna_size, n_count = struct.unpack(e + "II", self._r.read(off, 8))
        # N blocks (the only blocks fetch() uses) + the mask-block count, which
        # we need solely to locate the packed DNA.  The mask blocks themselves
        # can be megabytes (human chr1 has ~330k of them) and are never used,
        # so they are deliberately NOT downloaded.
        npos = off + 8
        blk = self._r.read(npos, 8 * n_count + 4)
        if n_count:
            n_starts = struct.unpack_from(e + f"{n_count}I", blk, 0)
            n_sizes = struct.unpack_from(e + f"{n_count}I", blk, 4 * n_count)
        else:
            n_starts = n_sizes = ()
        (m_count,) = struct.unpack_from(e + "I", blk, 8 * n_count)
        packed_start = npos + 8 * n_count + 4 + 8 * m_count + 4
        meta = {"dna_size": dna_size, "n_starts": n_starts,
                "n_sizes": n_sizes, "packed_start": packed_start}
        with self._lock:
            self._meta[chrom] = meta
        return meta

    def size(self, chrom: str) -> int:
        return self._load_meta(chrom)["dna_size"]

    def chroms(self) -> dict[str, int]:
        return {name: self.size(name) for name in self.sequence_names}

    def fetch(self, chrom: str, start: int, end: int) -> str:
        """Return sequence for [start, end), upper case, clipped to the chrom."""
        meta = self._load_meta(chrom)
        dna_size = meta["dna_size"]
        start = max(0, int(start))
        end = min(int(end), dna_size)
        if end <= start:
            return ""
        first_byte = start >> 2
        nbytes = ((end - 1) >> 2) - first_byte + 1
        raw = self._r.read(meta["packed_start"] + first_byte, nbytes)
        buf = b"".join(_PACK_LUT[b] for b in raw)
        begin = start - (first_byte << 2)
        seq = bytearray(buf[begin:begin + (end - start)])
        for s, size in zip(meta["n_starts"], meta["n_sizes"]):
            e = s + size
            if e <= start or s >= end:
                continue
            a = max(s, start) - start
            b = min(e, end) - start
            seq[a:b] = b"N" * (b - a)
        return seq.decode("ascii")

    def n_runs(self, chrom: str) -> list[tuple[int, int]]:
        meta = self._load_meta(chrom)
        return list(zip(meta["n_starts"], meta["n_sizes"]))

    def close(self) -> None:
        with self._lock:
            self._meta.clear()

