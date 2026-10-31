"""生成一份用于文档演示的「自组装基因组 + GFF3」。

用途：说明非模式物种怎么用自己的 FASTA / GFF3。仓库里不放真实研究数据，
截图统一用这里生成的合成数据（序列随机、基因坐标随机，但结构合法）。

    python tools/make_demo_assembly.py <输出目录>

产出：
    genome.fa       3 条 scaffold（150 kb / 90 kb / 60 kb），60 bp 换行
    annotation.gff3 约 30 个基因，正负链混合，2–5 个外显子，带 CDS 与 UTR
"""
from __future__ import annotations

import random
import sys
from pathlib import Path

SCAFFOLDS = [("scaffold_1", 150_000), ("scaffold_2", 90_000), ("scaffold_3", 60_000)]
SEED = 20261031


def sequence(rng: random.Random, n: int) -> str:
    # GC 含量压到 ~42%，看起来像普通真核基因组而不是随机噪声
    pool = "AT" * 58 + "GC" * 42
    return "".join(rng.choice(pool) for _ in range(n))


def genes_for(rng: random.Random, scaffold: str, length: int, start_id: int):
    """在一条 scaffold 上铺基因，返回 (gff3 行, 下一个可用编号)。"""
    rows: list[str] = []
    gid = start_id
    pos = 6_000
    while pos < length - 12_000:
        span = rng.randint(3_000, 6_500)
        if pos + span > length - 2_000:
            break
        strand = "+" if gid % 2 else "-"
        n_exon = rng.randint(2, 5)
        # 外显子按比例切开，内含子留 300–1200 bp
        inner = span - (n_exon - 1) * rng.randint(300, 1_200)
        if inner < n_exon * 120:
            pos += span + 1_200
            continue
        weights = [rng.uniform(0.6, 1.8) for _ in range(n_exon)]
        total = sum(weights)
        exons, cur = [], pos
        for w in weights:
            elen = max(120, int(inner * w / total))
            exons.append((cur, cur + elen))
            cur += elen + rng.randint(300, 1_200)
        exons[-1] = (exons[-1][0], min(exons[-1][0] + (exons[-1][1] - exons[-1][0]), pos + span))
        gstart, gend = exons[0][0], exons[-1][1]
        # CDS 从第一个外显子内部开始、到最后一个外显子内部结束（两端留 UTR）
        cds_start = exons[0][0] + rng.randint(40, 90)
        cds_end = exons[-1][1] - rng.randint(40, 90)
        if cds_end <= cds_start:
            pos = gend + 3_000
            continue

        name = f"g{gid}"
        rows.append(f"{scaffold}\tDEMO\tgene\t{gstart}\t{gend}\t.\t{strand}\t.\tID={name};Name={name}")
        rows.append(f"{scaffold}\tDEMO\tmRNA\t{gstart}\t{gend}\t.\t{strand}\t.\tID={name}.t1;Parent={name}")
        for i, (s, e) in enumerate(exons, 1):
            rows.append(f"{scaffold}\tDEMO\texon\t{s}\t{e}\t.\t{strand}\t.\tID={name}.t1.exon{i};Parent={name}.t1")
        # CDS 只取与 CDS 区间相交的部分，按转录方向编号
        cds_parts = [(max(s, cds_start), min(e, cds_end)) for s, e in exons if e > cds_start and s < cds_end]
        if strand == "-":
            cds_parts = cds_parts[::-1]
        for i, (s, e) in enumerate(cds_parts, 1):
            rows.append(f"{scaffold}\tDEMO\tCDS\t{s}\t{e}\t.\t{strand}\t{i - 1}\tID={name}.t1.cds{i};Parent={name}.t1")
        gid += 1
        pos = gend + rng.randint(900, 2_600)
    return rows, gid


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "demo-assembly")
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)

    fa, gff = [], ["##gff-version 3"]
    gid = 1
    for name, length in SCAFFOLDS:
        seq = sequence(rng, length)
        fa.append(f">{name}")
        for i in range(0, len(seq), 60):
            fa.append(seq[i:i + 60])
        rows, gid = genes_for(rng, name, length, gid)
        gff.extend(rows)

    (out / "genome.fa").write_text("\n".join(fa) + "\n", encoding="utf-8")
    (out / "annotation.gff3").write_text("\n".join(gff) + "\n", encoding="utf-8")
    print(f"wrote {out/'genome.fa'} ({(out/'genome.fa').stat().st_size/1e3:.0f} KB)")
    print(f"wrote {out/'annotation.gff3'} ({len(gff)-1} rows, {gid-1} genes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
