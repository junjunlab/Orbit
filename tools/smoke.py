#!/usr/bin/env python3
"""End-to-end HTTP check of a running server: every assembly, every endpoint.

    python tools/smoke.py [--port 8765]
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:{port}/api/"


def get(port: int, name: str, **params):
    qs = urllib.parse.urlencode(params)
    with urllib.request.urlopen(BASE.format(port=port) + name + "?" + qs, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    port = args.port

    health = get(port, "health")
    assert health.get("ok"), health
    cat = get(port, "catalog")
    fails = 0
    print(f"catalog: {len(cat['assemblies'])} assemblies")
    for a in cat["assemblies"]:
        db = a["id"]
        chroms = a["chroms"]
        primary = a.get("primary") or list(chroms)
        chrom = primary[0]
        length = chroms[chrom]
        # a quarter along the chromosome: avoids the centromere, where both
        # genes and GC content are legitimately empty
        mid = length // 4
        s, e = mid, mid + 60_000
        row = [f"{db:6s}"]

        g = get(port, "genes", db=db, chrom=chrom, s=s, e=e)
        row.append(f"genes={len(g['genes']):4d}")

        if a["hasSeq"]:
            sq = get(port, "seq", db=db, chrom=chrom, s=s, e=s + 120)
            seq = sq.get("seq") or ""
            ok_seq = len(seq) == 120 and set(seq) <= set("ACGTN")
            row.append("seq=" + ("ok" if ok_seq else "BAD"))
            fails += 0 if ok_seq else 1
            gc = get(port, "gc", db=db, chrom=chrom, s=s, e=e, bins=200)
            vals = [v for v in gc["gc"] if v is not None]
            ok_gc = len(vals) >= 50
            row.append(f"gc={len(vals)}" + ("" if ok_gc else " BAD"))
            fails += 0 if ok_gc else 1
        else:
            row.append("seq=missing")

        if a["hasCyto"]:
            cb = get(port, "cytobands", db=db)
            n = sum(len(v) for v in cb["bands"].values())
            row.append(f"bands={n}")
            fails += 0 if n else 1

        landmark = {"hg38": "TP53", "hg19": "TP53", "mm39": "Trp53", "mm10": "Trp53"}.get(db)
        if landmark:
            hits = get(port, "search", db=db, q=landmark)["hits"]
            gene = next((h for h in hits if h["type"] == "gene"), None)
            row.append("search=" + (gene["name"] if gene else "MISS"))
            fails += 0 if gene else 1

        print("  " + "  ".join(row))

    tracks = get(port, "bwtracks")["tracks"]
    print(f"bigWig: {len(tracks)} track(s)")
    for t in tracks:
        probe = t.get("probe") or {}
        chrom = next(iter(probe), None)
        if not chrom:
            continue
        d = get(port, "bw", track=t["id"], chrom=chrom, s=1_000_000, e=1_100_000, bins=50)
        got = sum(1 for v in d["values"] if v)
        print(f"  {t['id']:16s} peak={d['peak']:<10} nonempty={got}/50")

    print("\nSMOKE OK" if not fails else f"\n{fails} FAILURE(S)")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
