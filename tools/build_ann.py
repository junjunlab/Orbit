#!/usr/bin/env python3
"""Build the local binary annotation store + catalog from raw UCSC downloads.

    python tools/build_ann.py hg38 hg19 mm10 mm39
"""
from __future__ import annotations

import gzip
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from igvlocal.annbin import AnnWriter  # noqa: E402

DATA = ROOT / "data"
RAW = DATA / "raw"
ANN = DATA / "ann"
GENOMES = DATA / "genomes"

DEFAULT_DBS = ["hg38", "hg19", "mm39", "mm10"]


ROMAN_RE = re.compile(r"^chr([IVX]+)$")
_ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}


def _roman(s: str) -> int:
    total = 0
    for i, ch in enumerate(s):
        v = _ROMAN[ch]
        if i + 1 < len(s) and _ROMAN[s[i + 1]] > v:
            total -= v
        else:
            total += v
    return total


def natural_key(chrom: str):
    m = re.match(r"^(?:chr)?(\d+)$", chrom)
    if m:
        return (0, int(m.group(1)), "")
    # fly: chr2L / chr2R / chr3L / chr3R
    m = re.match(r"^(?:chr)?(\d+)([LR])$", chrom)
    if m:
        return (0, int(m.group(1)), m.group(2))
    # worm / yeast: chrI .. chrXVI (Roman numerals)
    m = ROMAN_RE.match(chrom)
    if m:
        return (0, _roman(m.group(1)), "")
    m = re.match(r"^(?:chr)?([XYMZW])$", chrom)
    if m:
        return (1, {"X": 0, "Y": 1, "Z": 2, "W": 3, "M": 4}[m.group(1)], "")
    return (2, 0, chrom)


# Primary chromosomes across model organisms: chr1..chr99, chr2L/2R/3L/3R (fly),
# chrI..chrXVI (worm/yeast Roman), chrX/Y/M/Z/W.  Scaffolds (names with "_" or
# chrUn*) are excluded so the genome overview shows real chromosomes only.
PRIMARY_RE = re.compile(r"^chr(?:[0-9]{1,2}[LR]?|[IVX]+|[XYMZW])$")


def primary_list(chroms) -> list[str]:
    prim = [c for c in chroms
            if PRIMARY_RE.match(c) and "_" not in c and not c.startswith("chrUn")]
    return prim or list(chroms)


def read_chrom_sizes(db: str) -> dict[str, int]:
    path = RAW / db / "chrom.sizes"
    sizes: dict[str, int] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            parts = line.split("\t")
            if len(parts) >= 2 and parts[1].isdigit():
                sizes[parts[0]] = int(parts[1])
    if not sizes:
        # fall back to the packed genome so a catalog entry can still be built
        two_bit = GENOMES / f"{db}.2bit"
        if two_bit.exists():
            from igvlocal.twobit import TwoBitFile

            tb = TwoBitFile(two_bit)
            sizes = tb.chroms()
            tb.close()
    return sizes


def build_genes(db: str) -> dict:
    src = RAW / db / "refGene.txt.gz"
    if not src.exists():
        return {"ok": False, "reason": "no refGene"}
    sizes = read_chrom_sizes(db)
    writer = AnnWriter()
    writer.set_chroms(sizes)

    genes: dict[tuple[str, str], dict] = {}
    seen_tx: set[tuple] = set()
    n_rows = 0
    n_written = 0
    CLUSTER_GAP = 1_000_000  # split same-symbol transcripts that sit far apart
    with gzip.open(src, "rt", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            f = line.rstrip("\n").split("\t")
            if len(f) < 16:
                continue
            n_rows += 1
            _bin, tx_name, chrom, strand, tx_start, tx_end, cds_start, cds_end, \
                exon_count, exon_starts, exon_ends = f[:11]
            symbol = f[12] or tx_name
            if not chrom or not tx_start.isdigit():
                continue
            tx_start, tx_end = int(tx_start), int(tx_end)
            cds_start, cds_end = int(cds_start), int(cds_end)
            try:
                starts = [int(x) for x in exon_starts.strip(",").split(",") if x]
                ends = [int(x) for x in exon_ends.strip(",").split(",") if x]
            except ValueError:
                continue
            if not starts or len(starts) != len(ends):
                continue
            exons = [[s, e] for s, e in zip(starts, ends) if e > s]
            if not exons:
                continue
            sig = (chrom, tx_name, tx_start, tx_end, tuple(map(tuple, exons)))
            if sig in seen_tx:
                continue
            seen_tx.add(sig)
            key = (chrom, symbol)
            gene = genes.get(key)
            if gene is None:
                gene = {"start": tx_start, "end": tx_end, "strand": strand,
                        "name": symbol, "tx": [], "clusters": []}
                genes[key] = gene
            # attach to an existing cluster when the transcript is nearby
            target = None
            for cl in gene["clusters"]:
                if tx_start <= cl[1] + CLUSTER_GAP and tx_end >= cl[0] - CLUSTER_GAP:
                    target = cl
                    break
            if target is None:
                target = [tx_start, tx_end]
                gene["clusters"].append(target)
                gene["tx"].append([])
            else:
                target[0] = min(target[0], tx_start)
                target[1] = max(target[1], tx_end)
            gene["tx"][gene["clusters"].index(target)].append(
                (tx_name, tx_start, tx_end, cds_start, cds_end, exons))

    for (chrom, _symbol), gene in genes.items():
        for i, cl in enumerate(gene["clusters"]):
            txs = gene["tx"][i]
            if not txs:
                continue
            writer.add_gene(chrom, cl[0], cl[1], gene["strand"], gene["name"], txs)
            n_written += 1

    out = ANN / db / "genes.igvbin"
    info = writer.write(out)
    info.update({"ok": True, "rows": n_rows, "genes": n_written})
    return info


def build_cytoband(db: str) -> int:
    src = RAW / db / "cytoBand.txt.gz"
    out = ANN / db / "cytoband.json"
    if not src.exists():
        return 0
    bands: dict[str, list] = {}
    with gzip.open(src, "rt", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            f = line.rstrip("\n").split("\t")
            if len(f) < 5:
                continue
            chrom, start, end, name, stain = f[0], f[1], f[2], f[3], f[4]
            if not start.isdigit():
                continue
            bands.setdefault(chrom, []).append([int(start), int(end), name, stain])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bands, separators=(",", ":")), encoding="utf-8")
    return sum(len(v) for v in bands.values())


def main() -> None:
    dbs = sys.argv[1:] or DEFAULT_DBS
    meta_path = DATA / "ucsc_genomes.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))["ucscGenomes"]

    catalog_path = DATA / "catalog.json"
    catalog = {"generated": time.strftime("%Y-%m-%d %H:%M:%S"), "assemblies": []}
    if catalog_path.exists():
        old = {a["id"]: a for a in json.loads(catalog_path.read_text(encoding="utf-8"))["assemblies"]}
    else:
        old = {}

    for db in dbs:
        print(f"== {db}")
        sizes = read_chrom_sizes(db)
        if not sizes:
            print("   no chrom.sizes, skipped")
            continue
        g = build_genes(db)
        print(f"   genes: {g}")
        bands = build_cytoband(db)
        print(f"   cytobands: {bands}")
        two_bit = GENOMES / f"{db}.2bit"
        entry = {
            "id": db,
            "organism": meta.get(db, {}).get("organism", db),
            "scientificName": meta.get(db, {}).get("scientificName", ""),
            "description": meta.get(db, {}).get("description", ""),
            "taxId": meta.get(db, {}).get("taxId", 0),
            "sourceName": meta.get(db, {}).get("sourceName", ""),
            "chroms": {c: sizes[c] for c in sorted(sizes, key=natural_key)},
            "primary": primary_list(sorted(sizes, key=natural_key)),
            "hasGenes": g.get("ok", False),
            "geneCount": g.get("genes", 0),
            "hasCyto": bands > 0,
            "hasSeq": two_bit.exists(),
            "seqBytes": two_bit.stat().st_size if two_bit.exists() else 0,
            "defaultPos": meta.get(db, {}).get("defaultPos", ""),
            # remote sequence source: Orbit reads this 2bit on demand over HTTP
            # Range when no local genomes/<db>.2bit is present (see twobit.py).
            "twoBitURL": f"https://hgdownload.soe.ucsc.edu/goldenPath/{db}/bigZips/{db}.2bit",
        }
        catalog["assemblies"].append(entry)

    for db, entry in old.items():
        if db not in dbs:
            catalog["assemblies"].append(entry)
    order = {d: i for i, d in enumerate(DEFAULT_DBS)}
    catalog["assemblies"].sort(key=lambda a: order.get(a["id"], 99))
    catalog_path.write_text(json.dumps(catalog, indent=1), encoding="utf-8")
    print(f"catalog: {catalog_path}")


if __name__ == "__main__":
    main()
