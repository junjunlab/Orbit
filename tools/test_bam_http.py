"""Read-only real-BAM HTTP integration probe; never registers or copies the BAM.

Usage: python tools/test_bam_http.py --bam <existing indexed BAM> [--serve]
The Store uses a private temporary directory.  --serve keeps that isolated UI
available until interrupted.  No user data/index or BAM sidecar is written.
"""
from __future__ import annotations

import argparse
from collections import Counter
import gzip
import json
from pathlib import Path
import struct
import sys
import tempfile
import threading
from time import perf_counter
from urllib.parse import urlencode
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from igvlocal import server
from igvlocal.loaded import BamSignal


def independent_window(path, chrom, start, end):
    """Sequential gzip + BAM-spec parser, independent of BGZF/BAI query code."""
    reads = Counter()
    depth = [0] * (end - start)
    cigchars = "MIDNSHP=X"
    with gzip.open(path, "rb") as f:
        assert f.read(4) == b"BAM\x01"
        textlen = struct.unpack("<i", f.read(4))[0]
        f.read(textlen)
        nref = struct.unpack("<i", f.read(4))[0]
        refs = []
        for _ in range(nref):
            n = struct.unpack("<i", f.read(4))[0]
            refs.append(f.read(n)[:-1].decode())
            f.read(4)
        target = refs.index(chrom)
        while True:
            raw = f.read(4)
            if not raw:
                break
            size = struct.unpack("<i", raw)[0]
            block = f.read(size)
            assert len(block) == size
            rid, pos, lrn, mq, _, ncig, flag = struct.unpack_from("<iiBBHHH", block)
            if rid > target or (rid == target and pos >= end):
                break  # This probe requires coordinate-sorted BAM.
            if rid != target or flag & (4 | 512 | 1024):
                continue
            ops = [struct.unpack_from("<I", block, 32 + lrn + 4 * i)[0] for i in range(ncig)]
            cursor = pos
            cigar = []
            for value in ops:
                op, length = value & 15, value >> 4
                cigar.append(str(length) + cigchars[op])
                if op in (0, 7, 8):
                    for bp in range(max(start, cursor), min(end, cursor + length)):
                        depth[bp - start] += 1
                if op in (0, 2, 3, 7, 8):
                    cursor += length
            if cursor > start and pos < end:
                name = block[32:32 + lrn - 1].decode("utf-8", "replace")
                reads[(pos, cursor, mq, flag, name, "".join(cigar))] += 1
    return reads, depth


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bam", type=Path, required=True)
    parser.add_argument("--chrom", default="I")
    parser.add_argument("--start", type=int, default=40000)
    parser.add_argument("--end", type=int, default=45000)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    bam = args.bam.resolve(strict=True)
    before = [(p, p.stat().st_size, p.stat().st_mtime_ns) for p in (bam, Path(str(bam) + ".bai"))]
    started = perf_counter()
    expected, depth = independent_window(bam, args.chrom, args.start, args.end)
    print(json.dumps({"independent_reads": sum(expected.values()), "baseline_ms": round((perf_counter() - started) * 1000)}, ensure_ascii=False), flush=True)
    with tempfile.TemporaryDirectory(prefix="orbit-bam-http-") as temp:
        store = server.Store(Path(temp))
        track = BamSignal("readonly-bam", bam.name, bam, index_path=Path(temp) / "probe.bai")
        assert track._chunks is not None, "Probe requires an existing BAI; will not build one"
        store.loaded.tracks[track.id] = track
        store.catalog = {"assemblies": [{"id": "probe", "organism": "Read-only BAM test", "description": "Isolated", "chroms": track.chroms, "hasSeq": False, "hasGenes": False}]}
        server.STORE = store
        httpd = server.QuietServer(("127.0.0.1", args.port), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        url = "http://127.0.0.1:" + str(httpd.server_port)
        params = {"track": track.id, "db": "probe", "chrom": args.chrom, "s": args.start, "e": args.end}
        def get(endpoint, **extra):
            with urlopen(url + "/api/" + endpoint + "?" + urlencode(dict(params, **extra)), timeout=90) as response:
                return json.load(response)
        try:
            t = perf_counter()
            data = get("loaded/bam", max=10)
            actual = Counter((r["p"], r["e"], r["q"], r["f"], r["n"], r["c"]) for r in data["reads"])
            assert actual == expected, (sum(actual.values()), sum(expected.values()), (actual - expected).most_common(3), (expected - actual).most_common(3))
            assert data["total"] == sum(expected.values()) and not data["sampled"]
            reads_ms = round((perf_counter() - t) * 1000)
            bins = 100
            coverage = get("bw", bins=bins)
            step = (args.end - args.start) // bins
            assert step * bins == args.end - args.start
            for i, value in enumerate(coverage["values"]):
                mean = sum(depth[i * step:(i + 1) * step]) / step
                observed = value["m"] if value else 0
                assert abs(observed - mean) < 0.00011, (i, observed, mean)
            junctions = get("loaded/junctions", min=1)
            report = {"PASS": True, "reads": len(data["reads"]), "http_reads_ms": reads_ms, "coverage_bins_equal_independent_baseline": bins, "junctions": len(junctions["junctions"]), "meta": track.meta(), "url": url + "/?db=probe&locus=" + args.chrom + ":" + str(args.start + 1) + "-" + str(args.end)}
            print(json.dumps(report, ensure_ascii=False), flush=True)
            if args.serve:
                threading.Event().wait()
        except KeyboardInterrupt:
            pass
        finally:
            httpd.shutdown()
            httpd.server_close()
            for p, size, mtime in before:
                assert p.stat().st_size == size and p.stat().st_mtime_ns == mtime, "Source BAM/BAI changed"


if __name__ == "__main__":
    main()
