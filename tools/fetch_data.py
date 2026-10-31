#!/usr/bin/env python3
"""Download UCSC annotation data and reference genomes.

UCSC's hgdownload host is heavily rate limited (~200 KB/s aggregate no matter
how many connections are used), so everything here is resumable, parallel and
idempotent.  Genome FASTA files for hg38/hg19 are pulled from the Google Cloud
public Broad reference bucket instead, which is ~20x faster.

Usage:
    python tools/fetch_data.py ann
    python tools/fetch_data.py genome-gcs hg38 hg19
    python tools/fetch_data.py genome-2bit mm10 mm39
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
GENOMES = DATA / "genomes"
LOG = DATA / "fetch.log"

UCSC = "https://hgdownload.soe.ucsc.edu/goldenPath"
GCS = "https://storage.googleapis.com/gcp-public-data--broad-references"

CURL_BASE = [
    "curl", "-sS", "-L", "--ssl-no-revoke",
    "--retry", "5", "--retry-delay", "3", "--retry-all-errors",
    "--connect-timeout", "30",
]

_log_lock = threading.Lock()


def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    with _log_lock:
        print(line, flush=True)
        try:
            with LOG.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass


def curl(url: str, dest: Path, extra: list[str] | None = None, timeout: int = 3600) -> bool:
    """Download url -> dest atomically. Returns True on success."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    resume: list[str] = []
    if tmp.exists() and tmp.stat().st_size > 0 and not extra:
        resume = ["-C", "-"]
    cmd = CURL_BASE + ["--max-time", str(timeout), "-o", str(tmp)] + resume + (extra or []) + [url]
    try:
        proc = subprocess.run(cmd, capture_output=True)
    except Exception as exc:  # noqa: BLE001
        log(f"ERR spawn {url}: {exc}")
        return False
    if proc.returncode != 0 or not tmp.exists() or tmp.stat().st_size == 0:
        log(f"  retry later {dest.name} ({tmp.stat().st_size if tmp.exists() else 0} B kept)")
        return False
    os.replace(tmp, dest)
    return True


def head_size(url: str) -> int | None:
    proc = subprocess.run(CURL_BASE + ["-I", url], capture_output=True, text=True)
    if proc.returncode != 0:
        return None
    for line in proc.stdout.splitlines():
        if line.lower().startswith("content-length:"):
            try:
                return int(line.split(":")[1].strip())
            except ValueError:
                return None
    return None


# ---------------------------------------------------------------- annotations
ANN_FILES = [
    ("refGene.txt.gz", "{base}/database/refGene.txt.gz"),
    ("cytoBand.txt.gz", "{base}/database/cytoBand.txt.gz"),
    ("chrom.sizes", "{base}/bigZips/{db}.chrom.sizes"),
]


def load_dbs() -> list[str]:
    meta = json.loads((DATA / "ucsc_genomes.json").read_text(encoding="utf-8"))
    genomes = meta["ucscGenomes"]
    # active assemblies only, newest first is not needed - keep stable order
    return sorted(d for d, v in genomes.items() if v.get("active", 1))


def fetch_one_db(db: str) -> tuple[str, list[str]]:
    base = f"{UCSC}/{db}"
    got = []
    for name, tmpl in ANN_FILES:
        dest = RAW / db / name
        if dest.exists() and dest.stat().st_size > 0:
            got.append(name)
            continue
        url = tmpl.format(base=base, db=db)
        if curl(url, dest, timeout=900):
            got.append(name)
    return db, got


def stage_ann(workers: int = 14, only: list[str] | None = None) -> None:
    dbs = load_dbs()
    if only:
        dbs = [d for d in dbs if d in set(only)]
    log(f"annotations: {len(dbs)} UCSC assemblies, {workers} workers")
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(fetch_one_db, db): db for db in dbs}
        for fut in as_completed(futs):
            db = futs[fut]
            try:
                db, got = fut.result()
            except Exception as exc:  # noqa: BLE001
                log(f"ERR {db}: {exc}")
                continue
            done += 1
            if done % 10 == 0 or "refGene.txt.gz" not in got:
                log(f"  {done}/{len(dbs)}  {db}  ({len(got)}/3 files)")
    log("annotations: done")


# -------------------------------------------------------------------- genomes
GCS_GENOMES = {
    "hg38": f"{GCS}/hg38/v0/Homo_sapiens_assembly38.fasta",
    "hg19": f"{GCS}/hg19/v0/Homo_sapiens_assembly19.fasta",
    # NCBI GRCm39 (= mm39); sequence names are NC_* and get renamed from the
    # NCBI assembly report so they match UCSC annotation chromosomes.
    "mm39": f"{GCS}/GRCm39/GCF_000001635.27_GRCm39_genomic.fna",
    # GRCm38 primary assembly == UCSC mm10; GCS is ~5x faster than UCSC
    # hgdownload, which throttles mm10.2bit hard.
    "mm10": f"{GCS}/mm10/v0/GRCm38.primary_assembly.genome.fa",
}

NCBI_REPORTS = {
    "mm39": ("https://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/000/001/635/"
             "GCF_000001635.27_GRCm39/GCF_000001635.27_GRCm39_assembly_report.txt"),
}
UCSC_2BIT = {
    "mm10": f"{UCSC}/mm10/bigZips/mm10.2bit",
    "mm39": f"{UCSC}/mm39/bigZips/mm39.2bit",
    "hg38": f"{UCSC}/hg38/bigZips/hg38.2bit",
    "hg19": f"{UCSC}/hg19/bigZips/hg19.2bit",
}


def chunked_download(url: str, dest: Path, conns: int = 12, chunk_mb: int = 4) -> bool:
    """Parallel range download with per-chunk resume."""
    if dest.exists() and dest.stat().st_size > 0:
        log(f"  {dest.name} already present")
        return True
    size = head_size(url)
    if not size:
        log(f"  cannot determine size for {url}")
        return False
    chunk = chunk_mb * 1024 * 1024
    nchunks = (size + chunk - 1) // chunk
    parts = dest.parent / (dest.name + ".parts")
    parts.mkdir(parents=True, exist_ok=True)
    log(f"  {dest.name}: {size/1e6:.0f} MB in {nchunks} chunks, {conns} conns")

    def get(i: int) -> bool:
        p = parts / f"{i:05d}"
        if p.exists() and p.stat().st_size == min(chunk, size - i * chunk):
            return True
        s = i * chunk
        e = min(size, s + chunk) - 1
        ok = curl(url, p, extra=["-r", f"{s}-{e}"], timeout=1200)
        return ok

    done = 0
    with ThreadPoolExecutor(max_workers=conns) as pool:
        futs = [pool.submit(get, i) for i in range(nchunks)]
        for fut in as_completed(futs):
            try:
                if fut.result():
                    done += 1
            except Exception:  # noqa: BLE001
                pass
            if done % 20 == 0:
                log(f"    {done}/{nchunks} chunks")

    ok_parts = [parts / f"{i:05d}" for i in range(nchunks)]
    if not all(p.exists() for p in ok_parts):
        log(f"  incomplete chunks for {dest.name}")
        return False
    tmp = dest.with_suffix(dest.suffix + ".part")
    with tmp.open("wb") as out:
        for p in ok_parts:
            with p.open("rb") as fh:
                while True:
                    buf = fh.read(8 << 20)
                    if not buf:
                        break
                    out.write(buf)
    if tmp.stat().st_size != size:
        log(f"  size mismatch {tmp.stat().st_size} != {size}")
        tmp.unlink(missing_ok=True)
        return False
    os.replace(tmp, dest)
    for p in ok_parts:
        p.unlink(missing_ok=True)
    parts.rmdir()
    return True


def stage_genome_gcs(names: list[str]) -> None:
    for name in names:
        url = GCS_GENOMES[name]
        dest = GENOMES / f"{name}.fasta"
        log(f"genome {name} from GCS")
        if dest.exists():
            log("  already present")
        elif chunked_download(url, dest, conns=8, chunk_mb=16):
            log(f"  ok {dest.stat().st_size/1e6:.0f} MB")
        else:
            log(f"  FAILED {name}")
            continue
        if name in NCBI_REPORTS:
            rep = GENOMES / f"{name}.assembly_report.txt"
            if not rep.exists() and curl(NCBI_REPORTS[name], rep, timeout=300):
                log(f"  assembly report ok ({rep.stat().st_size} B)")
            elif not rep.exists():
                log("  assembly report FAILED")


def stage_genome_2bit(names: list[str]) -> None:
    for name in names:
        url = UCSC_2BIT[name]
        dest = GENOMES / f"{name}.2bit"
        log(f"genome {name} 2bit from UCSC")
        if chunked_download(url, dest, conns=32, chunk_mb=2):
            log(f"  ok {dest.stat().st_size/1e6:.0f} MB")
        else:
            log(f"  FAILED {name}")


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        return
    stage = sys.argv[1]
    args = sys.argv[2:]
    if stage == "ann":
        stage_ann(only=args or None)
    elif stage == "genome-gcs":
        stage_genome_gcs(args or ["hg38", "hg19"])
    elif stage == "genome-2bit":
        stage_genome_2bit(args or ["mm10", "mm39"])
    else:
        print(f"unknown stage {stage}")


if __name__ == "__main__":
    main()
