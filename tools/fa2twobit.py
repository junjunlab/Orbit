#!/usr/bin/env python3
"""Convert a reference FASTA into UCSC .2bit (packed binary) form.

Keeps only primary chromosomes by default so the shipped genome file stays
small (chr1-22/X/Y/M for human, chr1-19/X/Y/M for mouse).

    python tools/fa2twobit.py data/genomes/hg38.fasta data/genomes/hg38.2bit
"""
from __future__ import annotations

import argparse
import re
import struct
import sys
from pathlib import Path

import numpy as np

SIGNATURE = 0x1A412743
PRIMARY = re.compile(r"^chr(\d{1,2}|X|Y|M|MT)$")
# b37-style references (Broad GCS bundles, Ensembl) name chromosomes "1"/"MT".
BARE = re.compile(r"^(\d{1,2}|X|Y|M|MT)$")


def normalize(name: str) -> str:
    """Map a bare chromosome name onto the UCSC `chr` form."""
    m = BARE.match(name)
    if not m:
        return name
    c = m.group(1)
    return "chrM" if c in ("M", "MT") else "chr" + c

LUT = np.zeros(256, dtype=np.uint8)
for ch, val in (("T", 0), ("U", 0), ("C", 1), ("A", 2), ("G", 3)):
    LUT[ord(ch)] = val
    LUT[ord(ch.lower())] = val


def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    if not mask.any():
        return []
    d = np.diff(np.concatenate(([0], mask.view(np.int8), [0])))
    starts = np.flatnonzero(d == 1)
    ends = np.flatnonzero(d == -1)
    return list(zip(starts.tolist(), (ends - starts).tolist()))


def load_assembly_report(path: Path) -> dict[str, str]:
    """Map NCBI accessions -> UCSC-style chromosome names."""
    mapping: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("#") or not line.strip():
            continue
        f = line.split("\t")
        if len(f) < 10:
            continue
        ucsc = f[9].strip()
        if not ucsc or ucsc == "na":
            continue
        for accn in (f[4].strip(), f[6].strip()):
            if accn and accn != "na":
                mapping[accn] = ucsc
                mapping[accn.split(".")[0]] = ucsc
    return mapping


def scan(fasta: Path, keep_primary: bool, rename: dict[str, str] | None = None) -> list[dict]:
    """First pass: sequence sizes plus N / mask block coordinates."""
    meta: list[dict] = []
    name = None
    chunks: list[bytes] = []
    with fasta.open("rb") as fh:
        for line in fh:
            if line[:1] == b">":
                if name is not None:
                    _finish(meta, name, chunks, keep_primary, rename)
                name = line[1:].strip().decode("latin-1").split()[0]
                chunks = []
            elif name is not None:
                chunks.append(line.strip())
        if name is not None:
            _finish(meta, name, chunks, keep_primary, rename)
    return meta


def _finish(meta, name, chunks, keep_primary, rename=None) -> None:
    target = name
    if rename:
        target = rename.get(name) or rename.get(name.split(".")[0]) or name
    target = normalize(target)
    if keep_primary and not PRIMARY.match(target):
        return
    seq = b"".join(chunks)
    if not seq:
        return
    arr = np.frombuffer(seq, dtype=np.uint8)
    is_n = (arr == ord("N")) | (arr == ord("n"))
    is_lower = (arr >= 97) & (arr <= 122)
    n_runs = runs(is_n)
    m_runs = runs(is_lower & ~is_n)
    size = len(seq)
    meta.append({
        "name": target,
        "fasta": name,
        "size": size,
        "n": n_runs,
        "m": m_runs,
        "data_size": 4 + 4 + 8 * len(n_runs) + 4 + 8 * len(m_runs) + 4 + (size + 3) // 4,
    })
    print(f"  scanned {name} -> {target}: {size:,} bp, {len(n_runs)} N-blocks, {len(m_runs)} masked",
          flush=True)


def write_2bit(fasta: Path, out: Path, meta: list[dict]) -> None:
    header_size = 16 + sum(1 + len(m["name"].encode("latin-1")) + 4 for m in meta)
    offset = header_size
    for m in meta:
        m["offset"] = offset
        offset += m["data_size"]

    wanted = {m["fasta"]: m for m in meta}
    with out.open("wb") as fh:
        fh.write(struct.pack(">IIII", SIGNATURE, 0, len(meta), 0))
        for m in meta:
            nb = m["name"].encode("latin-1")
            fh.write(struct.pack(">B", len(nb)) + nb + struct.pack(">I", m["offset"]))

        name = None
        chunks: list[bytes] = []
        done = 0
        with fasta.open("rb") as src:
            for line in src:
                if line[:1] == b">":
                    if name in wanted:
                        _emit(fh, wanted[name], b"".join(chunks))
                        done += 1
                        print(f"  wrote {name} ({done}/{len(meta)})", flush=True)
                    name = line[1:].strip().decode("latin-1").split()[0]
                    chunks = []
                elif name is not None:
                    chunks.append(line.strip())
            if name in wanted:
                _emit(fh, wanted[name], b"".join(chunks))
        fh.truncate(offset)


def _emit(fh, m: dict, seq: bytes) -> None:
    fh.write(struct.pack(">I", m["size"]))
    fh.write(struct.pack(">I", len(m["n"])))
    if m["n"]:
        fh.write(struct.pack(f">{len(m['n'])}I", *[s for s, _ in m["n"]]))
        fh.write(struct.pack(f">{len(m['n'])}I", *[l for _, l in m["n"]]))
    fh.write(struct.pack(">I", len(m["m"])))
    if m["m"]:
        fh.write(struct.pack(f">{len(m['m'])}I", *[s for s, _ in m["m"]]))
        fh.write(struct.pack(f">{len(m['m'])}I", *[l for _, l in m["m"]]))
    fh.write(struct.pack(">I", 0))

    arr = np.frombuffer(seq, dtype=np.uint8)
    vals = LUT[arr]
    pad = (-len(vals)) % 4
    if pad:
        vals = np.concatenate((vals, np.zeros(pad, dtype=np.uint8)))
    v = vals.reshape(-1, 4).astype(np.uint16)
    packed = ((v[:, 0] << 6) | (v[:, 1] << 4) | (v[:, 2] << 2) | v[:, 3]).astype(np.uint8)
    fh.write(packed.tobytes())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("fasta")
    ap.add_argument("out")
    ap.add_argument("--all-contigs", action="store_true",
                    help="keep every sequence, not just primary chromosomes")
    ap.add_argument("--assembly-report", default=None,
                    help="NCBI assembly_report.txt used to rename accessions to chr1/2/X/...")
    args = ap.parse_args()
    fasta, out = Path(args.fasta), Path(args.out)
    rename = load_assembly_report(Path(args.assembly_report)) if args.assembly_report else None
    print(f"scanning {fasta.name} ...", flush=True)
    meta = scan(fasta, keep_primary=not args.all_contigs, rename=rename)
    # natural chromosome order: 1..22, X, Y, M
    order = {f"chr{i}": i for i in range(1, 30)}
    order.update({"chrX": 90, "chrY": 91, "chrM": 92, "chrMT": 92})

    def key(m):
        n = m["name"]
        return (0, order.get(n, 80), n) if n in order else (1, 0, n)

    meta.sort(key=key)
    print(f"writing {out.name} ({sum(m['data_size'] for m in meta)/1e6:.0f} MB payload)", flush=True)
    write_2bit(fasta, out, meta)
    print(f"done: {out} {out.stat().st_size/1e6:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
