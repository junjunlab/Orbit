"""隔离验证 BAM junction/coverage 逻辑，不读写真实数据。"""
import struct
import types
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(ROOT))
from igvlocal.loaded import BamSignal, _coverage_summary  # noqa: E402


def block(flag=0, aux=b"", pos=100):
    name = b"r\0"
    cigar = [(10 << 4), (100 << 4) | 3, (10 << 4)]
    head = struct.pack("<iiBBHHHiiii", 0, pos, 2, 60, 0, 3, flag, 20, 0, 0, 0)
    seq = bytes([0x11]) * 10
    qual = bytes([30]) * 20
    return head + name + b"".join(struct.pack("<I", c) for c in cigar) + seq + qual + aux


def tag(name, typ, payload):
    return name.encode() + typ.encode() + payload


def run():
    b = block(aux=tag("TS", "Z", b"-\0") + tag("XS", "A", b"+") +
              tag("XA", "B", b"i" + struct.pack("<i", 2) + struct.pack("<ii", 7, 8)))
    obj = object.__new__(BamSignal)
    obj.resolve_chrom = lambda c: c
    obj._chunks = {}
    obj._scan = types.MethodType(lambda self, c, s, e: [(0, 120, 0, b)], obj)
    got = BamSignal.junctions(obj, "chr1", 0, 300, 1)
    assert got == [{"d": 110, "a": 210, "strand": "-", "n": 1}]
    assert BamSignal.junctions(obj, "chr1", 210, 220, 1) == []
    assert _coverage_summary([(0, 10), (110, 120)], 0, 120, 12)[1] is None
    x = object.__new__(BamSignal)
    x._bins, x._lin = {"chr1": {0: [(1, 2)]}}, {}
    assert x._bin_chunks("unknown", 0, 10) == ([], 0)
    assert x._bin_chunks("chr1", 10, 10) == ([], 0)
    obj._cache = {}
    cov = obj.summary('chr1', 100, 220, 12)
    assert cov[0]['m'] == 1 and cov[-1]['m'] == 1
    assert all(cell is None for cell in cov[1:-1]), cov
    cases = [
        (0x10, b'', '-'),
        (0, tag('XS', 'A', b'-'), '-'),
        (0x1 | 0x80 | 0x20, b'', '-'),
        (0x1 | 0x80 | 0x10, b'', '+'),
        (0x1 | 0x40 | 0x10, b'', '-'),
        (0, tag('XA', 'B', b'i' + struct.pack('<i', 2) + struct.pack('<ii', 7, 8)) + tag('XS', 'A', b'-'), '-'),
    ]
    for flags, aux, expected in cases:
        record = block(flag=flags, aux=aux)
        obj._scan = types.MethodType(lambda self, c, s, e, record=record: [(100, 220, 0, record)], obj)
        result = obj.junctions('chr1', 100, 220)
        assert len(result) == 1 and result[0]['strand'] == expected, (flags, result)
        assert obj.junctions('chr1', 100, 220, 2) == []
    assert x._bin_chunks('chr1', 0, 10)[0] == [(1, 2)], 'bin 0 must be retained'
    print('PASS: junction coordinates, TS/XS priority, QUAL offset, paired strands, B-array traversal, min count, real summary CIGAR N gap, bin0 and empty queries')


if __name__ == "__main__":
    run()
