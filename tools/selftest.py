#!/usr/bin/env python3
"""Round-trip self test for the binary formats (no network needed)."""
from __future__ import annotations

import random
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from igvlocal.annbin import AnnReader, AnnWriter  # noqa: E402
from igvlocal.twobit import TwoBitFile  # noqa: E402


def test_two_bit(tmp: Path) -> None:
    rnd = random.Random(7)
    seqs = {}
    for name, size in (("chr1", 5000), ("chrX", 1234), ("chrM", 200)):
        s = "".join(rnd.choice("ACGT") for _ in range(size))
        s = s[:100] + "N" * 40 + s[140:]
        s = s[:900] + s[900:1000].lower() + s[1000:]
        seqs[name] = s
    fasta = tmp / "t.fa"
    with fasta.open("w") as fh:
        for name, s in seqs.items():
            fh.write(f">{name} test\n")
            for i in range(0, len(s), 60):
                fh.write(s[i:i + 60] + "\n")

    out = tmp / "t.2bit"
    subprocess.run([sys.executable, str(ROOT / "tools" / "fa2twobit.py"),
                    str(fasta), str(out)], check=True, capture_output=True)

    tb = TwoBitFile(out)
    assert set(tb.chroms()) == set(seqs), tb.chroms()
    for name, s in seqs.items():
        assert tb.size(name) == len(s), (name, tb.size(name), len(s))
        assert tb.fetch(name, 0, len(s)).upper() == s.upper(), name
        for a in (0, 37, 99, 4000):
            b = min(len(s), a + 250)
            got = tb.fetch(name, a, b)
            assert got == s[a:b].upper(), (name, a, b, got[:20], s[a:a + 20])
    tb.close()
    print("  2bit round-trip  OK")


def test_annbin(tmp: Path) -> None:
    w = AnnWriter()
    w.set_chroms({"chr1": 100_000, "chr2": 50_000})
    genes = []
    rnd = random.Random(11)
    for i in range(400):
        chrom = "chr1" if i % 3 else "chr2"
        start = rnd.randrange(0, 95_000)
        end = start + rnd.randrange(500, 4000)
        txs = []
        for t in range(rnd.randrange(1, 4)):
            exons = []
            p = start
            while p < end - 100:
                exons.append([p, p + 80])
                p += 300
            txs.append((f"NM_{i}_{t}", start, end, start + 100, end - 100, exons))
        w.add_gene(chrom, start, end, rnd.choice("+-"), f"GENE{i}", txs)
        genes.append((chrom, start, end, f"GENE{i}"))
    path = tmp / "t.igvbin"
    info = w.write(path)
    r = AnnReader(path)
    assert r.count() == 400, r.count()
    total = 0
    for _ in range(60):
        chrom = rnd.choice(["chr1", "chr2"])
        s = rnd.randrange(0, 90_000)
        e = s + rnd.randrange(50, 5000)
        got = {(g.chrom, g.name) for g in r.query(chrom, s, e)}
        want = {(c, n) for c, gs, ge, n in genes if c == chrom and ge > s and gs < e}
        assert got == want, (chrom, s, e, len(got), len(want), got ^ want)
        total += len(got)
    names = {g.name for g in r.iter_all()}
    assert len(names) == 400
    assert r.find_names("GENE1")[0].name.startswith("GENE1")
    print(f"  igvbin round-trip OK ({info['records']} records, {info['bytes']/1024:.0f} KB)")
    r.close()


def test_bigwig() -> None:
    """Cross-check binned summaries against raw interval aggregation."""
    from igvlocal.bigwig import BigWig

    files = sorted((ROOT / "data" / "bw-data").glob("*.bw"))
    if not files:
        print("  bigWig           skipped (no data/bw-data/*.bw)")
        return
    path = files[0]
    bw = BigWig(path)
    chrom = next((c for c in ("chr1", "chr2", "chrX") if c in bw.chroms), None)
    if chrom is None:
        bw.close()
        print("  bigWig           skipped (no standard chromosome)")
        return
    for start, span in ((1_000_000, 100_000), (5_000_000, 20_000)):
        end = min(start + span, bw.chroms[chrom])
        bins = 100
        step = (end - start) / bins
        summaries = bw.summary(chrom, start, end, bins)
        raw = bw.intervals(chrom, start, end, limit=4_000_000)
        assert len(summaries) == bins, len(summaries)
        # spot-check 12 bins that the raw interval list covers completely
        checked = 0
        for i in range(0, bins, 8):
            b0, b1 = start + i * step, start + (i + 1) * step
            tot = 0.0
            covered = 0
            for (s, e, v) in raw:
                ov = min(e, b1) - max(s, b0)
                if ov > 0:
                    tot += ov * v
                    covered += ov
            if covered < step * 0.98:
                continue
            want = tot / step
            got = summaries[i]["m"]
            assert abs(got - want) <= max(0.02 * abs(want), 0.02), (chrom, i, got, want)
            checked += 1
        assert checked >= 3, f"only {checked} bins verified"
    print(f"  bigWig binning   OK ({path.name}, {len(bw.zooms)} zoom levels)")
    bw.close()


def main() -> None:
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        test_two_bit(tmp)
        test_annbin(tmp)
    test_bigwig()
    print("all good")


if __name__ == "__main__":
    main()
