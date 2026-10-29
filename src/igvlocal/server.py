"""Local genome browser backend.

Pure standard library HTTP server that serves the web UI and exposes a small
JSON API backed by the packed binary files in ``data/``:

    /api/catalog                 assemblies + chromosome sizes
    /api/genes?db&chrom&s&e      gene models from the .igvbin index
    /api/seq?db&chrom&s&e        packed 2bit sequence
    /api/gc?db&chrom&s&e&bins    GC content profile
    /api/cytobands?db            ideogram bands
    /api/search?db&q             gene symbol search
    /api/bwtracks                bigWig tracks (bundled dirs + user-loaded)
    /api/bw?track&chrom&s&e      binned signal values
    /api/load?name=...           POST a user file (bigWig/bedGraph/BAM/GTF/FASTA)
    /api/loaded                  list user-loaded tracks
    /api/loaded/genes?track&...  GTF gene models
    /api/loaded/seq?track&...    FASTA sequence slice
"""
from __future__ import annotations

import gzip
import json
import os
import re
import socket
import struct
import sys
import threading
import time
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .annbin import AnnReader
from .bigwig import BigWig, BigWigError
from .loaded import LoadedManager, RepeatTrack, _chrom_variants
from .motif import MAX_SPAN, MotifError, find_motif
from .twobit import RemoteTwoBitFile, TwoBitFile, TwoBitError

FROZEN = getattr(sys, "frozen", False)


def _base_dir() -> Path:
    if FROZEN:
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def _web_dir() -> Path:
    if FROZEN:
        return Path(getattr(sys, "_MEIPASS", _base_dir())) / "web"
    return Path(__file__).resolve().parents[1] / "web"


class Store:
    """Lazy, thread-safe access to catalog + binary data files."""

    def __init__(self, data_dir: Path):
        self.data = data_dir
        self._lock = threading.Lock()
        self._genomes: dict[str, TwoBitFile] = {}
        self._ann: dict[str, AnnReader] = {}
        self._cyto: dict[str, dict] = {}
        self._names: dict[str, dict[str, list]] = {}
        self._bw: dict[str, BigWig] = {}
        self._bw_tracks: list[dict] | None = None
        self.catalog: dict = {"assemblies": []}
        self.reload_catalog()
        self.loaded = LoadedManager(data_dir)

    # ------------------------------------------------------------- bigwig dirs
    def bw_dirs(self) -> list[Path]:
        dirs = []
        env = os.environ.get("IGV_BW_DIR")
        if env:
            dirs.append(Path(env))
        dirs.append(self.data / "bw-data")
        dirs.append(self.data / "bw")
        return dirs

    def bw_tracks(self, refresh: bool = False) -> list[dict]:
        with self._lock:
            if self._bw_tracks is not None and not refresh:
                return self._bw_tracks
        tracks = []
        seen = set()
        for d in self.bw_dirs():
            if not d.is_dir():
                continue
            for f in sorted(d.iterdir()):
                if f.suffix.lower() not in (".bw", ".bigwig") or not f.is_file():
                    continue
                tid = f.stem
                if tid in seen:
                    continue
                seen.add(tid)
                tracks.append({"id": tid, "name": f.name, "path": str(f),
                               "bytes": f.stat().st_size})
        with self._lock:
            self._bw_tracks = tracks
        return tracks

    def bigwig(self, track_id: str) -> BigWig | None:
        with self._lock:
            if track_id in self._bw:
                return self._bw[track_id]
        meta = next((t for t in self.bw_tracks() if t["id"] == track_id), None)
        if meta is None:
            return None
        try:
            bw = BigWig(meta["path"])
        except (BigWigError, OSError):
            return None
        with self._lock:
            self._bw[track_id] = bw
        return bw

    def reload_catalog(self) -> None:
        path = self.data / "catalog.json"
        if path.exists():
            self.catalog = json.loads(path.read_text(encoding="utf-8"))
        else:
            self.catalog = {"assemblies": []}
        self.sync_seq_flags()

    def sync_seq_flags(self) -> None:
        """``catalog.json`` 里的 ``hasSeq`` 是构建时写死的；实际分发包**可能不带序列**
        （纯注释版只有几十 MB，genomes/ 是空的）。

        判定顺序：本地有 ``genomes/<db>.2bit`` → 有序列；否则若该装配在 catalog 里
        带 ``twoBitURL``（远程 2bit，按窗口 HTTP Range 读取）→ 也算有序列；
        设置环境变量 ``ORBIT_OFFLINE=1`` 可强制关闭远程、只认本地。
        """
        offline = bool(os.environ.get("ORBIT_OFFLINE"))
        for a in self.catalog.get("assemblies", []):
            p = self.data / "genomes" / f"{a.get('id')}.2bit"
            local = p.exists()
            remote = (not offline) and bool(a.get("twoBitURL"))
            a["hasSeq"] = local or remote
            a["seqRemote"] = remote and not local

    # ---------------------------------------------------------------- lookups
    def assembly(self, db: str) -> dict | None:
        for a in self.catalog["assemblies"]:
            if a["id"] == db:
                return a
        return None

    def genome(self, db: str) -> TwoBitFile | RemoteTwoBitFile | None:
        """Sequence reader for ``db``: local ``genomes/<db>.2bit`` if present,
        otherwise the catalog's ``twoBitURL`` read on demand over HTTP Range."""
        with self._lock:
            if db in self._genomes:
                return self._genomes[db]
        path = self.data / "genomes" / f"{db}.2bit"
        g: TwoBitFile | RemoteTwoBitFile | None = None
        if path.exists():
            try:
                g = TwoBitFile(path)
            except (TwoBitError, OSError):
                g = None
        if g is None and not os.environ.get("ORBIT_OFFLINE"):
            asm = self.assembly(db)
            url = (asm or {}).get("twoBitURL")
            if url:
                try:
                    g = RemoteTwoBitFile(url)
                except (TwoBitError, OSError):
                    g = None
        if g is None:
            return None
        with self._lock:
            self._genomes[db] = g
        return g

    def ann(self, db: str) -> AnnReader | None:
        with self._lock:
            if db in self._ann:
                return self._ann[db]
        path = self.data / "ann" / db / "genes.igvbin"
        if not path.exists():
            return None
        r = AnnReader(path)
        with self._lock:
            self._ann[db] = r
        return r

    def cyto(self, db: str) -> dict:
        with self._lock:
            if db in self._cyto:
                return self._cyto[db]
        path = self.data / "ann" / db / "cytoband.json"
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        with self._lock:
            self._cyto[db] = data
        return data

    def name_index(self, db: str) -> dict[str, list]:
        """symbol -> [chrom, start, end, strand, name] for instant search.

        The dict key is upper-cased so lookups stay case-insensitive, but each
        record keeps the *original* symbol for display: mouse symbols are
        mixed case (Trp53, not TRP53) while human ones are upper case
        (TP53) -- both follow their own community convention.
        """
        with self._lock:
            if db in self._names:
                return self._names[db]
        reader = self.ann(db)
        idx: dict[str, list] = {}
        if reader is not None:
            for gene in reader.iter_all():
                idx.setdefault(gene.name.upper(), []).append(
                    [gene.chrom, gene.start, gene.end, gene.strand, gene.name])
        with self._lock:
            self._names[db] = idx
        return idx


STORE: Store


def parse_locus(q: str, chroms: dict[str, int]) -> tuple[str, int, int] | None:
    """Parse 'chr1:1,000-2,000' / 'chr1' / '1:1000-2000'."""
    q = q.strip().replace(",", "")
    m = re.match(r"^([\w.\-]+)(?::([\d,]+)(?:-([\d,]+))?)?$", q)
    if not m:
        return None
    chrom = m.group(1)
    if chrom not in chroms:
        alt = chrom if chrom.startswith("chr") else "chr" + chrom
        if alt in chroms:
            chrom = alt
        elif chrom.lower() in {c.lower(): c for c in chroms}:
            chrom = {c.lower(): c for c in chroms}[chrom.lower()]
        else:
            return None
    length = chroms[chrom]
    start = int(m.group(2)) - 1 if m.group(2) else 0
    end = int(m.group(3)) if m.group(3) else min(length, start + 100_000)
    start = max(0, min(start, length - 1))
    end = max(start + 1, min(end, length))
    return chrom, start, end


class Handler(BaseHTTPRequestHandler):
    server_version = "Orbit/1.0"
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------------ plumbing
    def log_message(self, fmt, *args):  # keep the console quiet
        if os.environ.get("IGV_DEBUG"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, body: bytes, ctype: str, status=HTTPStatus.OK, cache: str = "no-store"):
        accepts_gzip = "gzip" in (self.headers.get("Accept-Encoding") or "")
        if os.environ.get("ORBIT_NO_GZIP"):      # 诊断开关：排查某些 WebView 的 gzip 解码问题
            accepts_gzip = False
        headers_extra = []
        if accepts_gzip and len(body) > 1024 and not ctype.startswith(("image/", "font/")):
            body = gzip.compress(body, 6)
            headers_extra.append(("Content-Encoding", "gzip"))
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        for k, v in headers_extra:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)
        if os.environ.get("IGV_DEBUG"):
            sys.stderr.write(f"  -> wrote {len(body)} bytes for {self.path}\n")

    def _json(self, obj, status=HTTPStatus.OK):
        self._send(json.dumps(obj, separators=(",", ":")).encode(), "application/json; charset=utf-8", status)

    def _error(self, msg: str, status=HTTPStatus.BAD_REQUEST):
        self._json({"error": msg}, status)

    def do_GET(self):  # noqa: N802
        try:
            self._route()
        except BrokenPipeError:
            pass
        except Exception as exc:  # noqa: BLE001
            if os.environ.get("IGV_DEBUG"):
                import traceback
                traceback.print_exc()
            try:
                self._error(f"{type(exc).__name__}: {exc}", HTTPStatus.INTERNAL_SERVER_ERROR)
            except Exception:  # noqa: BLE001
                pass

    def do_POST(self):  # noqa: N802
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/load":
                return self._handle_load(parse_qs(parsed.query))
            if parsed.path == "/api/clientlog":
                return self._handle_clientlog()
            self._error("unknown endpoint", HTTPStatus.NOT_FOUND)
        except Exception as exc:  # noqa: BLE001
            if os.environ.get("IGV_DEBUG"):
                import traceback
                traceback.print_exc()
            try:
                self._error(f"{type(exc).__name__}: {exc}", HTTPStatus.INTERNAL_SERVER_ERROR)
            except Exception:  # noqa: BLE001
                pass

    def do_DELETE(self):  # noqa: N802
        try:
            parsed = urlparse(self.path)
            qs = parse_qs(parsed.query)
            if parsed.path == "/api/loaded":
                tid = (qs.get("id") or [""])[0]
                return self._json({"ok": STORE.loaded.remove(tid)})
            self._error("unknown endpoint", HTTPStatus.NOT_FOUND)
        except Exception as exc:  # noqa: BLE001
            try:
                self._error(f"{type(exc).__name__}: {exc}", HTTPStatus.INTERNAL_SERVER_ERROR)
            except Exception:  # noqa: BLE001
                pass

    def _handle_clientlog(self):
        """前端崩溃上报。

        桌面版没有控制台可看（PyInstaller --windowed），所以页面里的
        window.onerror / unhandledrejection 会 POST 到这里，落到
        ``<data>/client.log``，出问题时直接看这个文件。"""
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(min(length, 64 << 10)) if length > 0 else b""
        text = body.decode("utf-8", "replace").strip()
        line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {text}\n"
        try:
            with open(STORE.data / "client.log", "a", encoding="utf-8") as f:
                f.write(line)
        except OSError:
            pass
        if os.environ.get("IGV_DEBUG"):
            sys.stderr.write("CLIENT " + text[:4000] + "\n")
        self._json({"ok": True})

    def _handle_load(self, qs: dict):
        name = (qs.get("name") or [""])[0] or (self.headers.get("X-Filename") or "").strip()
        if not name:
            return self._error("缺少文件名（?name=）")
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return self._error("空文件")
        tmp = STORE.loaded.dir / f"_upload_{os.getpid()}_{threading.get_ident()}.tmp"
        try:
            with open(tmp, "wb") as f:
                remaining = length
                while remaining > 0:
                    chunk = self.rfile.read(min(1 << 20, remaining))
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)
            track = STORE.loaded.add(tmp, name)
        finally:
            try:
                tmp.unlink()
            except OSError:
                pass
        return self._json({"ok": True, "track": track.meta()})

    def _route(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path.startswith("/api/"):
            return self._api(path[5:], qs)
        return self._static(path)

    # -------------------------------------------------------------------- static
    def _static(self, path: str):
        if path in ("/", "/index.html"):
            rel = "index.html"
        else:
            rel = path.lstrip("/")
            if rel.startswith("static/"):
                rel = rel[7:]
        target = (_web_dir() / rel).resolve()
        web = _web_dir().resolve()
        if not str(target).startswith(str(web)) or not target.is_file():
            return self._error("not found", HTTPStatus.NOT_FOUND)
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".ico": "image/x-icon",
            ".json": "application/json",
        }.get(target.suffix.lower(), "application/octet-stream")
        self._send(target.read_bytes(), ctype, cache="no-cache")

    # ----------------------------------------------------------------------- api
    def _api(self, name: str, qs: dict):
        t0 = time.perf_counter()
        db = (qs.get("db") or [""])[0]

        if name == "catalog":
            if not STORE.catalog["assemblies"]:
                STORE.reload_catalog()
            else:
                # 每次取 catalog 都按磁盘校正一次 hasSeq：用户事后把 .2bit
                # 放进 data/genomes/ 后刷新页面就能用，不必重启程序。
                STORE.sync_seq_flags()
            return self._json(STORE.catalog)

        if name == "health":
            return self._json({"ok": True, "version": "1.0"})

        if name == "font":
            # 矢量 PDF 要用系统里的中文字体（前端裁剪后嵌入），字体文件本身不必再 gzip
            data, fname = _system_font()
            self._send(data, "font/ttf", cache="max-age=86400")
            return
 

        if name == "bwtracks":
            out = []
            for t in STORE.bw_tracks(refresh="1" in qs):
                bw = STORE.bigwig(t["id"])
                # A few chromosome sizes act as an assembly fingerprint so the
                # front end can tell whether a track belongs to the current build.
                probe = {}
                if bw:
                    for c in ("chr1", "chr2", "chrX"):
                        if c in bw.chroms:
                            probe[c] = bw.chroms[c]
                out.append({"id": t["id"], "name": t["name"], "bytes": t["bytes"],
                            "chroms": len(bw.chroms) if bw else 0,
                            "probe": probe,
                            "max": round(bw.total["max"], 2) if bw and bw.total else None,
                            "loaded": False})
            # user-imported signal tracks (bigWig / bedGraph / BAM coverage)
            for lt in STORE.loaded.signals():
                m = lt.meta()
                m["loaded"] = True
                out.append(m)
            return self._json({"tracks": out})

        if name == "bw":
            tid = (qs.get("track") or [""])[0]
            chrom = (qs.get("chrom") or [""])[0]
            start = int((qs.get("s") or ["0"])[0])
            end = int((qs.get("e") or ["0"])[0])
            bins = int((qs.get("bins") or ["700"])[0])
            bins = max(10, min(bins, 4000))
            lt = STORE.loaded.get(tid)
            if lt is not None and lt.kind == "signal":
                lchrom = lt.resolve_chrom(chrom)  # chr8 <-> 8 (Ensembl naming)
                if lchrom not in lt.chroms:
                    return self._json({"values": [], "reason": f"该文件不含 {chrom}"})
                # BAM 的 chroms 来自文件头（人类参考序列约 195 条），而 _iv 只收
                # 真正有比对记录的染色体。二者之差就是「头里有定义、实际零比对」，
                # 必须显式告知前端；否则 values 为空数组会让前端画出一条空坐标轴
                # （peak=0 → 0 – 2.0e-9 的诡异刻度），看起来就像 track 坏了。
                iv = getattr(lt, "_iv", None)
                if iv is not None and lchrom not in iv:
                    return self._json({"values": [], "start": start, "end": end,
                                       "bins": bins,
                                       "reason": f"该 BAM 在 {chrom} 没有比对记录"})
                values = lt.summary(lchrom, start, end, bins)
                peak = 0.0
                for v in values:
                    if v and v.get("m", 0) > peak:
                        peak = v["m"]
                fmax = (lt.total or {}).get("max") if isinstance(lt.total, dict) else None
                return self._json({"values": values, "start": start, "end": end,
                                   "bins": bins, "peak": round(peak, 4),
                                   "fileMax": round(fmax, 3) if fmax is not None else None})
            bw = STORE.bigwig(tid)
            if bw is None:
                return self._error("unknown track", HTTPStatus.NOT_FOUND)
            if chrom not in bw.chroms:
                return self._json({"values": [], "reason": f"该文件不含 {chrom}"})
            values = bw.summary(chrom, start, end, bins)
            peak = 0.0
            for v in values:
                if v and v["m"] > peak:
                    peak = v["m"]
            return self._json({"values": values, "start": start, "end": end,
                               "bins": bins, "peak": round(peak, 4),
                               "fileMax": round(bw.total["max"], 3) if bw.total else None})

        if name == "loaded":
            return self._json({"tracks": STORE.loaded.metas(), "dir": str(STORE.loaded.dir)})

        if name == "loaded/genes":
            tid = (qs.get("track") or [""])[0]
            t = STORE.loaded.get(tid)
            if t is None or t.kind != "gene":
                return self._error("unknown gene track", HTTPStatus.NOT_FOUND)
            chrom = (qs.get("chrom") or [""])[0]
            start = int((qs.get("s") or ["0"])[0])
            end = int((qs.get("e") or ["0"])[0])
            limit = 3000
            if isinstance(t, RepeatTrack):
                # 重复注释一条染色体上就有几十万个拷贝：先按窗口算总数，
                # 再让 query 均匀抽样（取前 N 个会全堆在视野左边缘）
                total = t.count_hits(chrom, start, end)
                genes = t.query(chrom, start, end, limit=limit)
                truncated = total > limit
            else:
                genes = t.query(chrom, start, end)
                truncated = len(genes) > limit
            payload = [g.to_dict() for g in genes[:limit]]
            return self._json({"genes": payload, "truncated": truncated,
                               "ms": round((time.perf_counter() - t0) * 1000, 2)})

        if name == "loaded/repeats":
            # 重复注释的密度带：低倍视野下逐个画元件会糊成一片
            tid = (qs.get("track") or [""])[0]
            t = STORE.loaded.get(tid)
            if t is None or not isinstance(t, RepeatTrack):
                return self._error("unknown repeat track", HTTPStatus.NOT_FOUND)
            chrom = (qs.get("chrom") or [""])[0]
            start = int((qs.get("s") or ["0"])[0])
            end = int((qs.get("e") or ["0"])[0])
            bins = int((qs.get("bins") or ["900"])[0])
            bins = max(50, min(bins, 4000))
            counts = t.summary(chrom, start, end, bins)
            return self._json({"bins": counts, "max": max(counts) if counts else 0,
                               "total": sum(counts),
                               "ms": round((time.perf_counter() - t0) * 1000, 2)})

        if name == "loaded/seq":
            tid = (qs.get("track") or [""])[0]
            t = STORE.loaded.get(tid)
            if t is None or t.kind != "seq":
                return self._error("unknown sequence track", HTTPStatus.NOT_FOUND)
            chrom = (qs.get("chrom") or [""])[0]
            start = int((qs.get("s") or ["0"])[0])
            end = int((qs.get("e") or ["0"])[0])
            if end - start > 2_000_000:
                return self._error("range too large for sequence")
            return self._json({"seq": t.fetch(chrom, start, end), "start": start})

        if name == "loaded/bam":
            # 原始比对记录（IGV 的 reads 堆叠视图）。coverage 走 /api/bw，
            # 这里只取窗口内的 read，前端按 CIGAR 画成一行行灰块 + 错配色点。
            tid = (qs.get("track") or [""])[0]
            t = STORE.loaded.get(tid)
            if t is None or t.format != "bam":
                return self._error("unknown BAM track", HTTPStatus.NOT_FOUND)
            chrom = (qs.get("chrom") or [""])[0]
            start = int((qs.get("s") or ["0"])[0])
            end = int((qs.get("e") or ["0"])[0])
            max_n = int((qs.get("max") or ["1500"])[0])
            max_n = max(10, min(max_n, 4000))
            genome = STORE.genome(db)
            ref = genome.fetch if (genome is not None and chrom in genome) else None
            reads, total, sampled = t.reads(chrom, start, end, max_n, ref)
            reason = None
            if not reads and not t.has_reads(chrom):
                reason = f"该 BAM 在 {chrom} 没有比对记录"
            return self._json({"reads": reads, "total": total, "sampled": sampled,
                               "start": start, "end": end, "reason": reason,
                               "hasSeq": t.has_seq, "paired": t.paired,
                               "ms": round((time.perf_counter() - t0) * 1000, 2)})

        asm = STORE.assembly(db)
        if asm is None:
            return self._error(f"unknown assembly: {db}", HTTPStatus.NOT_FOUND)

        if name == "cytobands":
            return self._json({"db": db, "bands": STORE.cyto(db)})

        if name == "genes":
            chrom = (qs.get("chrom") or [""])[0]
            start = int((qs.get("s") or ["0"])[0])
            end = int((qs.get("e") or ["0"])[0])
            reader = STORE.ann(db)
            if reader is None:
                return self._json({"genes": [], "truncated": False, "ms": 0})
            genes = reader.query(chrom, start, end)
            limit = 3000
            truncated = len(genes) > limit
            if truncated:
                # keep the ones closest to the view so rendering stays readable
                genes = genes[:limit]
            payload = [g.to_dict() for g in genes]
            return self._json({"genes": payload, "truncated": truncated,
                               "ms": round((time.perf_counter() - t0) * 1000, 2)})

        if name == "seq":
            chrom = (qs.get("chrom") or [""])[0]
            start = int((qs.get("s") or ["0"])[0])
            end = int((qs.get("e") or ["0"])[0])
            if end - start > 2_000_000:
                return self._error("range too large for sequence")
            genome = STORE.genome(db)
            if genome is None or chrom not in genome:
                return self._json({"seq": None,
                                   "reason": "无可用序列（本地无 2bit，远程不可达或已禁用）"})
            seq = genome.fetch(chrom, start, end)
            return self._json({"seq": seq, "start": start})

        if name == "motif":
            # Find Motif：在当前视野里找一段序列（支持 IUPAC 简并碱基与正则），
            # 正负链都扫，返回带链方向的位点，前端画成两条轨道。
            chrom = (qs.get("chrom") or [""])[0]
            start = max(0, int((qs.get("s") or ["0"])[0]))
            end = int((qs.get("e") or ["0"])[0])
            pattern = (qs.get("pattern") or [""])[0]
            if end <= start:
                return self._json({"hits": [], "reason": "视野为空"})
            if end - start > MAX_SPAN:
                return self._error(f"区域太大（> {MAX_SPAN // 1_000_000} Mb），请放大后再查找")
            genome = STORE.genome(db)
            if genome is None or chrom not in genome:
                return self._json({"hits": [], "reason": "当前装配没有内置序列，无法查找 motif"})
            try:
                seq = genome.fetch(chrom, start, min(end, genome.size(chrom)))
                res = find_motif(seq, pattern, start)
            except MotifError as e:
                return self._error(str(e))
            res.update({"chrom": chrom, "start": start, "end": end,
                        "ms": round((time.perf_counter() - t0) * 1000, 2)})
            return self._json(res)

        if name == "gc":
            chrom = (qs.get("chrom") or [""])[0]
            start = int((qs.get("s") or ["0"])[0])
            end = int((qs.get("e") or ["0"])[0])
            bins = int((qs.get("bins") or ["500"])[0])
            genome = STORE.genome(db)
            if genome is None or chrom not in genome:
                return self._json({"gc": None, "reason": "no sequence bundled"})
            return self._json({"gc": gc_profile(genome, chrom, start, end, bins)})

        if name == "search":
            q = (qs.get("q") or [""])[0].strip()
            if not q:
                return self._json({"hits": []})
            hits = []
            locus = parse_locus(q, asm["chroms"])
            if locus:
                hits.append({"type": "locus", "chrom": locus[0],
                             "start": locus[1], "end": locus[2],
                             "label": f"{locus[0]}:{locus[1]+1:,}-{locus[2]:,}"})
            idx = STORE.name_index(db)
            up = q.upper()
            exact = idx.get(up, [])
            pref, sub = [], []
            for name_, pos in idx.items():
                if name_ == up:
                    continue
                if name_.startswith(up):
                    pref.append((name_, pos))
                    if len(pref) >= 30:
                        break
            if len(exact) < 5:
                for name_, pos in idx.items():
                    if up in name_ and not name_.startswith(up) and name_ != up:
                        sub.append((name_, pos))
                        if len(sub) >= 15:
                            break
            # p[4] 是原始符号（保留大小写）；匹配仍用大写 key
            for p in exact:
                hits.append({"type": "gene", "name": p[4], "chrom": p[0],
                             "start": p[1], "end": p[2], "strand": p[3]})
            for name_, positions in pref:
                p = positions[0]
                hits.append({"type": "gene", "name": p[4], "chrom": p[0],
                             "start": p[1], "end": p[2], "strand": p[3]})
            for name_, positions in sub:
                p = positions[0]
                hits.append({"type": "gene", "name": p[4], "chrom": p[0],
                             "start": p[1], "end": p[2], "strand": p[3]})
            return self._json({"hits": hits[:30]})

        if name == "loaded/search":
            # Search gene names inside user-imported GTF/GFF tracks. ``track``
            # may be a single track id or "all". Gene coordinates are mapped
            # from the file's chromosome naming (Ensembl ``8``) back to the
            # assembly's (``chr8``) so the front end can navigate there.
            q = (qs.get("q") or [""])[0].strip()
            tid = (qs.get("track") or ["all"])[0]
            if not q:
                return self._json({"hits": []})
            tracks = STORE.loaded.gene_tracks()
            if tid and tid != "all":
                tracks = [t for t in tracks if t.id == tid]
            asm_chroms = asm["chroms"]
            hits = []
            seen = set()
            for t in tracks:
                for g in t.search_names(q, limit=20):
                    key = (t.id, g.name, g.chrom, g.start, g.end)
                    if key in seen:
                        continue
                    seen.add(key)
                    chrom = g.chrom
                    if chrom not in asm_chroms:
                        for v in _chrom_variants(chrom):
                            if v in asm_chroms:
                                chrom = v
                                break
                    hits.append({"type": "loaded-gene", "track": t.id,
                                 "trackName": t.name, "name": g.name,
                                 "chrom": chrom, "start": g.start,
                                 "end": g.end, "strand": g.strand})
                    if len(hits) >= 30:
                        break
                if len(hits) >= 30:
                    break
            return self._json({"hits": hits,
                               "ms": round((time.perf_counter() - t0) * 1000, 2)})

        if name == "gene":
            chrom = (qs.get("chrom") or [""])[0]
            gname = (qs.get("name") or [""])[0]
            start = int((qs.get("s") or ["0"])[0])
            end = int((qs.get("e") or ["0"])[0])
            reader = STORE.ann(db)
            if reader is None:
                return self._json({"gene": None})
            for g in reader.query(chrom, start, end):
                if g.name.upper() == gname.upper():
                    return self._json({"gene": g.to_dict()})
            return self._json({"gene": None})

        return self._error("unknown endpoint", HTTPStatus.NOT_FOUND)


_GC_CACHE: dict[tuple, list] = {}
_GC_CACHE_MAX = 512


def _gc_of(seq: str) -> float | None:
    if not seq:
        return None
    g = seq.count("G") + seq.count("C")
    tot = len(seq) - seq.count("N")
    return round(g / tot, 4) if tot > 10 else None


def _gc_remember(key: tuple, out: list) -> None:
    if len(_GC_CACHE) >= _GC_CACHE_MAX:
        _GC_CACHE.clear()
    _GC_CACHE[key] = out


def gc_profile(genome: TwoBitFile, chrom: str, start: int, end: int, bins: int) -> list:
    """GC fraction per bin.

    Local 2bit reads the whole window in one go (fast disk) and computes every
    bin exactly. A *remote* 2bit must not do that: each bin used to become its
    own HTTP Range round-trip (up to ~5600 of them for a whole-chromosome view),
    which saturated the shared keep-alive connection and stalled every other
    request behind it. For remote and/or large windows we instead read a bounded
    number of sample chunks and interpolate to the requested bin count, so a
    request always finishes in a second or two.
    """
    length = end - start
    if length <= 0:
        return []
    try:
        chrom_len = genome.chroms.get(chrom)
    except Exception:  # noqa: BLE001
        chrom_len = None
    if chrom_len:
        end = min(end, chrom_len)
        length = end - start
        if length <= 0:
            return []

    bins = max(10, min(bins, 4000))
    # never ask for windows smaller than ~20 bp, they are pure noise
    if length < bins * 20:
        bins = max(6, length // 20)
    bins = max(1, bins)
    step = length / bins

    key = (id(genome), chrom, start, end, bins)
    hit = _GC_CACHE.get(key)
    if hit is not None:
        return hit

    remote = isinstance(genome, RemoteTwoBitFile)

    # ---- exact path: one contiguous fetch, but only for windows small enough
    # that it is cheap. A whole chromosome must never be materialised as one
    # string (~250 MB) even on local disk.
    if length <= 80_000 or (not remote and length <= 4_000_000):
        try:
            seq = genome.fetch(chrom, start, end)
        except Exception:  # noqa: BLE001
            seq = ""
        if seq:
            out = []
            for i in range(bins):
                a = int(round(i * step))
                b = int(round((i + 1) * step))
                if b <= a:
                    b = a + 1
                out.append(_gc_of(seq[a:b]))
            _gc_remember(key, out)
            return out
        if not remote:
            return [None] * bins

    # ---- bounded sampling path (remote and/or large window)
    # Local disk can afford many more probes than a remote host, so the sample
    # density scales with where the sequence comes from.
    n_pts = 200 if not remote else 40
    budget = 2_000_000 if not remote else 200_000
    chunk = max(600, min(int(length / n_pts), budget // n_pts, 8000))

    spans = []
    for i in range(n_pts):
        mid = int(start + (i + 0.5) * length / n_pts)
        a = max(start, min(mid - chunk // 2, end - chunk))
        b = min(end, a + chunk)
        if b > a:
            spans.append((a, b))
    if not spans:
        return [None] * bins

    def _one(ab):
        a, b = ab
        try:
            return _gc_of(genome.fetch(chrom, a, b))
        except Exception:  # noqa: BLE001
            return None

    # Fetch the sample chunks concurrently: the reader keeps a small connection
    # pool, so their round-trips overlap instead of queueing one by one.
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(4, len(spans))) as pool:
        vals = list(pool.map(_one, spans))
    xs = [(a + b) / 2 for a, b in spans]

    out = []
    lo = 0
    for j in range(bins):
        x = start + (j + 0.5) * step
        if x <= xs[0]:
            out.append(vals[0])
            continue
        if x >= xs[-1]:
            out.append(vals[-1])
            continue
        while lo < len(xs) - 2 and xs[lo + 1] <= x:
            lo += 1
        v0, v1 = vals[lo], vals[lo + 1]
        if v0 is None:
            out.append(v1)
        elif v1 is None:
            out.append(v0)
        else:
            span = (xs[lo + 1] - xs[lo]) or 1
            t = (x - xs[lo]) / span
            out.append(round(v0 + (v1 - v0) * t, 4))
    _gc_remember(key, out)
    return out


def find_free_port(host: str, preferred: int) -> int:
    for port in [preferred] + list(range(preferred + 1, preferred + 20)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    raise RuntimeError("no free port")


# --------------------------------------------------------------- 导出用字体
# 矢量 PDF 里的中文必须随文件走（否则别人的 Illustrator 打开就掉字），
# 所以这里把系统里的一款中文字体原样吐给前端，由前端裁剪后嵌进 PDF。
_FONT_CANDIDATES = [
    os.environ.get("IGV_FONT", ""),
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simsun.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/arphic/uming.ttc",
]
_FONT_CACHE: dict[str, bytes] = {}


def _sfnt_dir(buf: bytes, off: int) -> dict[str, tuple[int, int]]:
    """读 sfnt 表目录：tag -> (offset, length)。"""
    n = struct.unpack_from(">H", buf, off + 4)[0]
    out = {}
    for i in range(n):
        o = off + 12 + i * 16
        tag = buf[o:o + 4].decode("latin-1")
        out[tag] = (struct.unpack_from(">I", buf, o + 8)[0], struct.unpack_from(">I", buf, o + 12)[0])
    return out


def _checksum(data: bytes) -> int:
    if len(data) % 4:
        data = data + b"\0" * (4 - len(data) % 4)
    return sum(struct.unpack(f">{len(data) // 4}I", data)) & 0xFFFFFFFF


def _flatten_ttc(buf: bytes) -> bytes:
    """从 .ttc 里抽出第一个字面，重写成独立 .ttf（PDF 的 FontFile2 不收集合体）。"""
    if buf[:4] != b"ttcf":
        return buf
    base = struct.unpack_from(">I", buf, 12)[0]
    tables = _sfnt_dir(buf, base)
    items = sorted(tables.items(), key=lambda kv: kv[0])
    n = len(items)
    header = bytearray(12 + 16 * n)
    struct.pack_into(">IHHHH", header, 0, 0x00010000, n, 0, 0, 0)
    body = bytearray()
    off = 12 + 16 * n
    for tag, (src, ln) in items:
        data = buf[src:src + ln]
        pad = (-len(body)) % 4
        body += b"\0" * pad
        o = off + len(body)
        body += data
        i = items.index((tag, (src, ln)))
        e = 12 + i * 16
        header[e:e + 4] = tag.encode("latin-1")
        struct.pack_into(">III", header, e + 4, _checksum(data), o, ln)
    return bytes(header + body)


def _system_font() -> tuple[bytes, str]:
    for p in _FONT_CANDIDATES:
        if not p or not os.path.isfile(p):
            continue
        if p in _FONT_CACHE:
            return _FONT_CACHE[p], os.path.basename(p)
        try:
            with open(p, "rb") as f:
                data = _flatten_ttc(f.read())
        except OSError:
            continue
        _FONT_CACHE[p] = data
        return data, os.path.basename(p)
    raise RuntimeError("no system CJK font found (set IGV_FONT)")


class QuietServer(ThreadingHTTPServer):
    """浏览器关标签页 / 取消请求时 socket 会被 RST，默认实现会喷一整页 traceback。

    这类断开是正常现象（尤其导出大图或频繁拖动时），不该出现在控制台上，
    其它真正的异常仍交给父类打印。"""

    def handle_error(self, request, client_address):  # noqa: D102
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def _serve_forever(httpd: ThreadingHTTPServer) -> None:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


def _wait_ready(host: str, port: int, timeout: float = 15.0) -> bool:
    """等端口真的能连上，再开窗口 —— 否则 WebView 会先撞一个 ERR_CONNECTION_REFUSED。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), 0.4):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def run(data_dir: Path | None = None, host: str = "127.0.0.1", port: int = 8765,
        open_browser: bool = True, mode: str | None = None, debug: bool = False) -> int:
    """启动后端并打开界面。

    mode:
        ``"window"``  原生 Qt 窗口（默认；PySide6 不可用时自动退回浏览器）
        ``"browser"`` 系统浏览器
        ``"none"``    只起服务，不打开任何界面
    """
    global STORE
    data = Path(data_dir) if data_dir else (_base_dir() / "data")
    STORE = Store(data)
    n = len(STORE.catalog.get("assemblies", []))
    port = find_free_port(host, port)
    httpd = QuietServer((host, port), Handler)
    httpd.daemon_threads = True
    url = f"http://{host}:{port}/"
    if mode is None:
        mode = "browser" if open_browser else "none"
    print("=" * 62)
    print("  Orbit  -  offline genome browser")
    print(f"  data dir : {data}")
    print(f"  loaded dir: {STORE.loaded.dir}")
    print(f"  assemblies: {n}")
    print(f"  open     : {url}  ({mode})")
    print("=" * 62, flush=True)

    try:
        if mode == "none":
            _serve_forever(httpd)
            return 0

        if mode == "browser":
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
            _serve_forever(httpd)
            return 0

        # ---- 原生窗口：服务跑在后台线程，主线程交给 Qt 事件循环 ----
        threading.Thread(target=_serve_forever, args=(httpd,), daemon=True).start()
        open_window = None
        try:
            from .qtwin import open_window  # noqa: F811
            print("  window   : Qt (QtWebEngine)")
        except Exception as exc:  # PySide6 没装（纯注释包 / 只装了标准库）
            print(f"  ! Qt 不可用（{exc}）→ 退回浏览器")

        _wait_ready(host, port)
        if open_window is not None:
            try:
                open_window(url, debug=debug)
                return 0
            except Exception as exc:  # QtWebEngine 初始化失败等
                print(f"  ! 原生窗口启动失败（{exc}）→ 退回浏览器")
        webbrowser.open(url)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            print("\nbye")
        return 0
    finally:
        try:
            httpd.shutdown()
        except Exception:
            pass
        httpd.server_close()

