"""BGZF boundary/BAI corruption regression, generated files only."""
from pathlib import Path
import struct
import tempfile

from test_bam_full_reads import bgzf, record, loaded
from igvlocal.loaded import BamSignal, _BgzfStream


def run():
    header = b"BAM\x01" + struct.pack("<ii", 0, 1) + struct.pack("<i", 5) + b"chr1\0" + struct.pack("<i", 100000)
    rows = [record("long", 100, "8M50000N11M", "A" * 19)]
    rows += [record(f"read{i}", 1000 + i * 20, "19M", "A" * 19) for i in range(100)]
    raw = bytearray(header)
    offsets = []
    for row in rows:
        offsets.append(len(raw))
        raw += struct.pack("<i", len(row)) + row
    # Put a length prefix at exactly the end and at 1/2/3 bytes before a block
    # boundary. Old build_index mixed previous pos with new buf_v.
    with tempfile.TemporaryDirectory(prefix="orbit-bai-boundary-") as tmp:
        root = Path(tmp)
        for remain in (0, 1, 2, 3):
            cut = offsets[1] + remain
            bam = root / f"split{remain}.bam"
            bam.write_bytes(bgzf(raw[:cut]) + bgzf(raw[cut:]) + bgzf(b""))
            track = BamSignal("test", "test", bam)
            assert track._chunks is not None
            got, total, sampled = track.reads("chr1", 1000, 1100)
            assert total == len(got) == 6 and not sampled, (remain, total)
            assert {r["n"] for r in got} == {"long", "read0", "read1", "read2", "read3", "read4"}
            for bins in track._bins.values():
                assert all(b < e for chunks in bins.values() for b, e in chunks)
            # Structural corruption is rejected without touching the original BAI.
            index = Path(str(bam) + ".bai")
            data = bytearray(index.read_bytes())
            assert struct.unpack_from("<i", data, 12)[0] > 0
            # First bin: id[12:16], n_chunk[16:20], chunk[20:36].
            struct.pack_into("<QQ", data, 20, 999999, 1)
            index.write_bytes(data)
            original = index.read_bytes()
            repaired = BamSignal("test", "test", bam)
            assert repaired.index_error and repaired._chunks is not None
            assert repaired._index_override.parent == bam.parent / ".cache"
            assert index.read_bytes() == original
            assert len(repaired.reads("chr1", 1000, 1100)[0]) == 6
        # 65536 bytes at block end must canonicalize to next compressed offset.
        full = root / "full.bgzf"
        block = bgzf(b"A" * 65536)
        full.write_bytes(block + bgzf(b"B") + bgzf(b""))
        stream = _BgzfStream(full)
        try:
            assert len(stream.read(65536)) == 65536
            assert stream.tell() == len(block) << 16
            assert stream.read(1) == b"B"
        finally:
            stream.close()
        # Unsorted files must not publish a partial/invalid BAI.
        bad = root / "unsorted.bam"
        raw_bad = header
        for row in (record("a", 500, "10M", "A" * 10), record("b", 100, "10M", "A" * 10)):
            raw_bad += struct.pack("<i", len(row)) + row
        bad.write_bytes(bgzf(raw_bad) + bgzf(b""))
        unsorted = BamSignal("bad", "bad", bad)
        assert unsorted._chunks is None and "coordinate-sorted" in unsorted.index_error
        assert not Path(str(bad) + ".bai").exists()
        assert len(unsorted.reads("chr1", 0, 1000)[0]) == 2
    print("PASS: BAI length-prefix boundary 0/1/2/3 bytes, canonical 64KiB offset, long-N overlap, corruption rejection/private rebuild, unsorted atomic failure")


if __name__ == "__main__":
    run()
