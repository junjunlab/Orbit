#!/usr/bin/env python3
"""Generate tiny sample files for exercising the import pipeline."""
from __future__ import annotations

import gzip
import struct
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data" / "samples"
OUT.mkdir(parents=True, exist_ok=True)

# --------------------------------------------------------------- bedGraph
with open(OUT / "demo_signal.bedgraph", "w", encoding="utf-8") as f:
    f.write("track type=bedGraph name=demo\n")
    for i in range(0, 400_000, 500):
        f.write(f"chr1\t{i}\t{i + 500}\t{(i // 500) % 40}\n")

# --------------------------------------------------------------- GTF
with open(OUT / "demo_genes.gtf", "w", encoding="utf-8") as f:
    f.write("# demo annotation\n")
    genes = [("GENE1", "chr1", 100_000, 130_000, "+"),
             ("GENE2", "chr1", 300_000, 320_000, "-")]
    for gid, chrom, s, e, strand in genes:
        f.write(f'{chrom}\tdemo\tgene\t{s+1}\t{e}\t.\t{strand}\t.\tgene_id "{gid}"; gene_name "{gid}"\n')
        tx = gid + ".t1"
        f.write(f'{chrom}\tdemo\ttranscript\t{s+1}\t{e}\t.\t{strand}\t.\tgene_id "{gid}"; transcript_id "{tx}"\n')
        for x1, x2 in [(s, s + 3000), (s + 9000, s + 14000), (e - 2000, e)]:
            f.write(f'{chrom}\tdemo\texon\t{x1+1}\t{x2}\t.\t{strand}\t.\tgene_id "{gid}"; transcript_id "{tx}"\n')
        f.write(f'{chrom}\tdemo\tCDS\t{s+5000}\t{e-3000}\t.\t{strand}\t.\tgene_id "{gid}"; transcript_id "{tx}"\n')

# --------------------------------------------------------------- FASTA
seq = "ACGT" * 100_000  # 400 kb
with open(OUT / "demo_seq.fa", "w", encoding="utf-8") as f:
    f.write(">chr1 demo sequence\n")
    for i in range(0, len(seq), 60):
        f.write(seq[i:i + 60] + "\n")

# --------------------------------------------------------------- BAM (minimal)
header_text = b"@HD\tVN:1.6\n@SQ\tSN:chr1\tLN:400000\n"
refs = [("chr1", 400_000)]
body = b"BAM\x01" + struct.pack("<i", len(header_text)) + header_text + struct.pack("<i", len(refs))
for nm, ln in refs:
    nb = nm.encode() + b"\0"
    body += struct.pack("<i", len(nb)) + nb + struct.pack("<i", ln)


def rec(pos: int, cigarlen: int = 50) -> bytes:
    rn = b"read1\0"
    cigar = (cigarlen << 4) | 0  # M
    fixed = struct.pack("<iiBBHHHiiii", 0, pos, len(rn), 60, 0, 1, 0, 0, -1, -1, 0)
    block = fixed + rn + struct.pack("<I", cigar)
    return struct.pack("<i", len(block)) + block


for i in range(5000):
    body += rec(100_000 + i * 100, 50)

with open(OUT / "demo_align.bam", "wb") as f:
    f.write(gzip.compress(body))

print("samples ->", OUT)
for p in sorted(OUT.iterdir()):
    print(f"  {p.name:20s} {p.stat().st_size:>10,d} B")
