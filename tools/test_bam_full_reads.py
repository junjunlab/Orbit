"""隔离验证全量 BAM/SAM reads；所有合成文件仅写入临时目录。"""
import inspect
from pathlib import Path
import io
import math
import struct
import sys
import tempfile
import types
import zlib
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(ROOT))
from igvlocal import loaded, server  # noqa: E402
from igvlocal.loaded import BamSignal, SamSignal, _decode_read, _mismatches  # noqa: E402


class UnindexedBam(BamSignal):
    def _load_index(self):
        return False

    def build_index(self):
        return False


def bgzf(data):
    compressor = zlib.compressobj(wbits=-15)
    payload = compressor.compress(data) + compressor.flush()
    size = 18 + len(payload) + 8
    assert size <= 65536
    header = b"\x1f\x8b\x08\x04" + bytes(6) + struct.pack("<H", 6)
    header += b"BC" + struct.pack("<HH", 2, size - 1)
    return header + payload + struct.pack("<II", zlib.crc32(data), len(data))


def record(name, pos, cigar, seq, flag=0):
    name_b = name.encode() + b"\0"
    ops = [(int(length), "MIDNSHP=X".index(op))
           for length, op in loaded.re.findall(r"(\d+)([MIDNSHP=X])", cigar)]
    head = struct.pack("<iiBBHHHiiii", 0, pos, len(name_b), 60, 0, len(ops),
                       flag, len(seq), -1, -1, 0)
    values = ["=ACMGRSVTWYHKDBN".index(base) for base in seq]
    packed = bytes((values[i] << 4) | (values[i + 1] if i + 1 < len(values) else 0)
                   for i in range(0, len(values), 2))
    return head + name_b + b"".join(struct.pack("<I", (n << 4) | op) for n, op in ops) + packed + bytes([30]) * len(seq)


def write_inputs(directory):
    rows = [(f"r{i}", 100, "20M", "A" * 20, 0) for i in range(257)]
    rows += [("left", 95, "15M", "C" * 15, 0),
             ("right", 105, "15M", "C" * 15, 0),
             ("secondary", 100, "20M", "A" * 20, 0x101),
             ("supplementary", 100, "20M", "A" * 20, 0x800)]
    rows += [(f"hidden{flag}", 100, "20M", "A" * 20, flag) for flag in (4, 0x200, 0x400)]
    rows += [("gaps", 1000, "5M10N5=3D5X", "A" * 15, 0)]
    rows.sort(key=lambda row: row[1])
    header = b"BAM\x01" + struct.pack("<ii", 0, 1) + struct.pack("<i", 5) + b"chr1\0" + struct.pack("<i", 10000)
    data = bytearray(header)
    for row in rows:
        blk = record(*row)
        data += struct.pack("<i", len(blk)) + blk
    bam = directory / "synthetic.bam"
    bam.write_bytes(b"".join(bgzf(data[i:i + 60000]) for i in range(0, len(data), 60000)) + bgzf(b""))
    sam = directory / "synthetic.sam"
    lines = ["@HD\tVN:1.6\tSO:coordinate", "@SQ\tSN:chr1\tLN:10000"]
    lines += [f"{name}\t{flag}\tchr1\t{pos + 1}\t60\t{cigar}\t*\t0\t0\t{seq}\t{'?' * len(seq)}"
              for name, pos, cigar, seq, flag in rows]
    sam.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return bam, sam


def check_track(track):
    calls = []

    def ref(chrom, start, end):
        calls.append((chrom, start, end))
        return "A" * (end - start)

    reads, total, sampled = track.reads("chr1", 100, 110, ref=ref)
    assert len(reads) == total == 261 and sampled is False, (len(reads), total, sampled)
    assert calls == [("chr1", 100, 110)], calls
    by_name = {r["n"]: r for r in reads}
    assert by_name["left"]["mm"] == [[i, "C"] for i in range(5, 15)]
    assert by_name["right"]["mm"] == [[i, "C"] for i in range(5)]
    assert "secondary" in by_name and "supplementary" in by_name
    assert not any(name.startswith("hidden") for name in by_name)
    for limit in (None, 0, -1):
        result, count, sampled = track.reads("chr1", 100, 110, max_n=limit)
        assert len(result) == count == 261 and sampled is False
    result, count, sampled = track.reads("chr1", 100, 110, max_n=7)
    assert len(result) == 7 and count == 261 and sampled is True
    assert track.reads("chr1", 500, 510) == ([], 0, False)
    assert track.reads("chr1", 120, 121) == ([], 0, False)
    cov = track.summary("chr1", 1000, 1028, 28)
    expected = set(range(0, 5)) | set(range(15, 20)) | set(range(23, 28))
    for i, cell in enumerate(cov):
        assert (cell == {"m": 1.0, "x": 1.0}) if i in expected else cell is None, (i, cell)
    assert track.summary("chr1", 1005, 1015, 10) == [None] * 10
    assert track.summary("chr1", 1020, 1023, 3) == [None] * 3
    calls.clear()
    missing_ref = lambda *args: None
    assert all(not r["mm"] for r in track.reads("chr1", 100, 110, ref=missing_ref)[0])


def check_api(track):
    fake_store = types.SimpleNamespace(loaded=types.SimpleNamespace(get=lambda tid: track),
                                       genome=lambda db: None)
    handler = object.__new__(server.Handler)
    handler._json = lambda body: body
    handler._error = lambda *args: (_ for _ in ()).throw(AssertionError(args))
    with patch.object(server, "STORE", fake_store, create=True):
        for limit in ("1", "10", "0", "not-a-number"):
            qs = {"track": [track.id], "chrom": ["chr1"], "s": ["100"], "e": ["110"], "max": [limit]}
            body = handler._api("loaded/bam", qs)
            assert len(body["reads"]) == body["total"] == 261 and body["sampled"] is False


def check_streaming(track):
    original_scan = track._scan
    decoded = []

    def decode(blk):
        decoded.append(True)
        return _decode_read(blk)

    def scan(chrom, start, end):
        for item in original_scan(chrom, start, end):
            before = len(decoded)
            yield item
            assert len(decoded) == before + 1, "索引读取必须边扫描边解码，不能先 list(_scan)"

    with patch.object(track, "_scan", scan), patch.object(loaded, "_decode_read", decode):
        assert len(track.reads("chr1", 100, 110)[0]) == 261


def check_experiment_stats():
    def classify(rows):
        stats = loaded._ReadStats()
        for length, ops in rows:
            stats.add(length, ops)
        return stats.meta()

    short = [(100, [(100, 0)])]
    assert classify(short * 19)["experimentType"] == "unknown"
    assert classify(short * 20)["experimentType"] == "other"
    long_simple = [(2000, [(2000, 0)])] * 20
    assert classify(long_simple)["experimentType"] == "other"
    assert classify(long_simple)["experimentStats"]["averageCigarLength"] == 5
    assert classify([(3000, [(1000, 0), (2000, 0)])] * 20)["experimentType"] == "other"
    assert classify([(1001, [(998, 0), (1, 1), (2, 0)])] * 20)["experimentType"] == "other"
    text_complex = classify([(1200, [(1000, 0), (100, 1), (100, 0)])] * 20)
    assert text_complex["experimentStats"]["averageCigarLength"] == 13
    assert text_complex["experimentType"] == "third_gen"
    complex_ops = [(100, 0)] * 11
    assert classify([(1100, complex_ops)] * 20)["experimentType"] == "third_gen"
    variable = classify([(100, complex_ops)] * 10 + [(400, complex_ops)] * 10)
    assert variable["experimentType"] == "third_gen"
    assert math.isclose(variable["experimentStats"]["readLengthStdDev"], math.sqrt(450000 / 19))
    assert classify([(1000, complex_ops)] * 20)["experimentType"] == "other"
    n_ratio = [(100, 0), (501, 3)]
    assert classify(short * 99 + [(100, n_ratio)])["experimentType"] == "rna"
    exact_ratio = classify(short * 99 + [(100, [(100, 0), (400, 3)])])
    assert exact_ratio["experimentStats"]["medianRefToReadRatio"] == 5
    assert exact_ratio["experimentType"] == "other"
    assert classify(short * 98 + [(100, [(100, 0), (1, 3)])] * 2)["experimentType"] == "rna"
    limited = classify(short * 1001)
    assert limited["experimentSampled"] == 1000

    def probe(blocks):
        obj = object.__new__(BamSignal)
        obj._read_stats = loaded._ReadStats()
        obj._refs = [("chr1", 10000)]
        obj.has_seq = obj.paired = False
        data = b"".join(struct.pack("<i", len(blk)) + blk for blk in blocks)
        stream = io.BytesIO(data)
        obj._probe_read_stats(stream)
        return obj, stream.tell()

    paired = record("pair", 100, "20M", "A" * 20, 1)
    obj, _ = probe([paired] * 20)
    assert obj.has_seq and obj.paired and obj._read_stats.meta()["experimentType"] == "other"
    unmapped = record("unmapped", 100, "20M", "A" * 20, 4)
    obj, _ = probe([unmapped] * 10000 + [paired] * 20)
    assert obj._read_stats.meta()["experimentSampled"] == 0
    with patch.object(loaded, "_EXPERIMENT_PROBE_BYTES", len(paired) + 4):
        obj, consumed = probe([paired] * 20)
        assert obj._read_stats.meta()["experimentSampled"] == 1 and consumed == len(paired) + 4
    obj, _ = probe([paired] * 1001)
    assert obj._read_stats.meta()["experimentSampled"] == 1000


def run():
    check_experiment_stats()
    assert inspect.signature(BamSignal).parameters["max_reads"].default is None
    assert inspect.signature(SamSignal).parameters["max_reads"].default is None
    rec = _decode_read(record("complex", 95, "2S4M2I3M4N3M2D4M", "C" * 18))
    assert _mismatches(rec, "A" * 20) == [[i, "C"] for i in list(range(7)) + list(range(11, 14)) + list(range(16, 20))]
    assert _mismatches(rec, "A" * 10, 100, (100, 110)) == [[5, "C"], [6, "C"], [11, "C"], [12, "C"], [13, "C"]]
    with tempfile.TemporaryDirectory(prefix="orbit-bam-test-") as tmp:
        bam, sam = write_inputs(Path(tmp))
        indexed = BamSignal("indexed", "indexed", bam)
        assert indexed.meta()["indexed"] is True and Path(str(bam) + ".bai").exists()
        unindexed = UnindexedBam("unindexed", "unindexed", bam)
        text = SamSignal("sam", "sam", sam)
        for track in (indexed, unindexed, text):
            check_track(track)
            check_api(track)
            assert track.meta()["experimentType"] == "other"
            assert track.meta()["experimentSampled"] == 264
            assert track.meta()["hasSeq"] is True
            assert track.meta()["paired"] is True
        check_streaming(indexed)
        for cls, path in ((UnindexedBam, bam), (SamSignal, sam)):
            exact = cls("exact", "exact", path, max_reads=262)
            assert exact.n_reads == 262 and exact.meta()["truncated"] is False
            limited = cls("limited", "limited", path, max_reads=261)
            assert limited.n_reads == 261 and limited.meta()["truncated"] is True
            unlimited = cls("unlimited", "unlimited", path, max_reads=0)
            assert unlimited.n_reads == 262 and unlimited.meta()["truncated"] is False
    print("PASS: indexed/unindexed/SAM 全量 reads、单次参考读取、越窗及复杂 CIGAR 错配、N/D 覆盖度缺口、API 忽略 max、流式解码、导入上限元数据、实验类型统计及有界采样、indexed hasSeq/paired")


if __name__ == "__main__":
    run()
