#!/usr/bin/env python3
"""Robust UCSC annotation fetcher with table fallbacks.

For each assembly, fetches:
  - chrom.sizes              (bigZips/<db>.chrom.sizes)
  - gene table               refGene -> ncbiRefSeq -> sgdGene (converted to refGene layout)
  - cytoband                 cytoBand -> cytoBandIdeo

curl runs with ``-f`` so a 404 body is never written to disk, and every .gz is
gzip-validated before being kept.  Idempotent: existing valid files are skipped.

    python tools/fetch_ann_fallback.py rn6 danRer10 dm3 ce10 sacCer2 xenTro9 galGal5
"""
from __future__ import annotations

import gzip
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
U = "https://hgdownload.soe.ucsc.edu/goldenPath"
CURL = ["curl", "-sS", "-L", "-f", "--ssl-no-revoke",
        "--retry", "3", "--retry-delay", "2", "--max-time", "600"]


def _valid_gzip(p: Path) -> bool:
    try:
        with gzip.open(p, "rb") as fh:
            fh.read(4)
        return True
    except Exception:  # noqa: BLE001
        return False


def dl(url: str, dest: Path) -> bool:
    """Download url -> dest; reject HTTP errors (curl -f) and non-gzip bodies."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    r = subprocess.run(CURL + ["-o", str(tmp), url], capture_output=True)
    if r.returncode != 0 or not tmp.exists() or tmp.stat().st_size == 0:
        tmp.unlink(missing_ok=True)
        return False
    if not _valid_gzip(tmp):
        tmp.unlink(missing_ok=True)
        return False
    tmp.replace(dest)
    return True


def dl_text(url: str, dest: Path) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    r = subprocess.run(CURL + ["-o", str(tmp), url], capture_output=True)
    if r.returncode != 0 or not tmp.exists() or tmp.stat().st_size == 0:
        tmp.unlink(missing_ok=True)
        return False
    tmp.replace(dest)
    return True


def convert_sgdgene(src: Path, dst: Path) -> None:
    """sgdGene -> refGene column layout (insert name2 = gene name at index 12)."""
    tmp = dst.with_suffix(dst.suffix + ".part")
    with gzip.open(src, "rt", encoding="utf-8", errors="replace") as fi, \
            gzip.open(tmp, "wt", encoding="utf-8") as fo:
        for line in fi:
            f = line.rstrip("\n").split("\t")
            if len(f) < 11:
                continue
            # bin..exonEnds (0..10) + score,name2,cdsStartStat,cdsEndStat,exonFrames
            fo.write("\t".join(f[0:11] + ["0", f[1], "unk", "unk", "0"]) + "\n")
    tmp.replace(dst)


def fetch(db: str) -> None:
    print(f"== {db}")
    cs = RAW / db / "chrom.sizes"
    if not (cs.exists() and cs.stat().st_size > 0):
        dl_text(f"{U}/{db}/bigZips/{db}.chrom.sizes", cs)
    print(f"   chrom.sizes: {'ok' if cs.exists() else 'MISSING'}"
          f" ({cs.stat().st_size if cs.exists() else 0} B)")

    gd = RAW / db / "refGene.txt.gz"
    if gd.exists() and _valid_gzip(gd):
        print("   genes: present")
    else:
        gd.unlink(missing_ok=True)
        for t in ("refGene", "ncbiRefSeq"):
            if dl(f"{U}/{db}/database/{t}.txt.gz", gd):
                print(f"   genes: {t}")
                break
        else:
            sg = RAW / db / "_sgdGene.txt.gz"
            if dl(f"{U}/{db}/database/sgdGene.txt.gz", sg):
                convert_sgdgene(sg, gd)
                sg.unlink(missing_ok=True)
                print("   genes: sgdGene -> refGene")
            else:
                print("   genes: NONE")

    cb = RAW / db / "cytoBand.txt.gz"
    if cb.exists() and _valid_gzip(cb):
        print("   cyto: present")
    else:
        cb.unlink(missing_ok=True)
        for t in ("cytoBand", "cytoBandIdeo"):
            if dl(f"{U}/{db}/database/{t}.txt.gz", cb):
                print(f"   cyto: {t}")
                break
        else:
            print("   cyto: none (ok)")


if __name__ == "__main__":
    dbs = sys.argv[1:]
    if not dbs:
        print(__doc__)
        sys.exit(0)
    for db in dbs:
        fetch(db)
