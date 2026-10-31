"""端到端复现/验证：自定义装配（__custom__）+ 导入 GFF3 的基因搜索。

跑法：
  PYTHONPATH=src <python> tools/test_loaded_search.py

步骤：
  1. 临时 data 目录（无 catalog.json → catalog 为空，等价「自定义（空）」）
  2. 起服务（--no-browser）
  3. POST 一个小 GFF3 到 /api/load
  4. 查 /api/loaded/search?db=__custom__&q=g149 （修复前这里 404）
  5. 同时检查 /api/search（内置范围）在自定义装配下返回 200 空命中而非 404
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORT = 8841
BASE = f"http://127.0.0.1:{PORT}"

GFF3 = """##gff-version 3
chr_x\tAUGUSTUS\tgene\t1000\t3000\t.\t+\t.\tID=g14980;Name=g14980
chr_x\tAUGUSTUS\tmRNA\t1000\t3000\t.\t+\t.\tID=g14980.t1;Parent=g14980
chr_x\tAUGUSTUS\texon\t1000\t1500\t.\t+\t.\tID=g14980.t1.exon1;Parent=g14980.t1
chr_x\tAUGUSTUS\texon\t2000\t3000\t.\t+\t.\tID=g14980.t1.exon2;Parent=g14980.t1
chr_x\tAUGUSTUS\tCDS\t1100\t1500\t.\t+\t0\tID=cds.g14980;Parent=g14980.t1
chr_x\tAUGUSTUS\tgene\t5000\t7000\t.\t-\t.\tID=g14930;Name=g14930
chr_x\tAUGUSTUS\tmRNA\t5000\t7000\t.\t-\t.\tID=g14930.t1;Parent=g14930
chr_x\tAUGUSTUS\texon\t5000\t7000\t.\t-\t.\tID=g14930.t1.exon1;Parent=g14930.t1
chr_x\tAUGUSTUS\tgene\t9000\t9500\t.\t+\t.\tID=g14984;Name=g14984
chr_x\tAUGUSTUS\tmRNA\t9000\t9500\t.\t+\t.\tID=g14984.t1;Parent=g14984
chr_x\tAUGUSTUS\texon\t9000\t9500\t.\t+\t.\tID=g14984.t1.exon1;Parent=g14984.t1
"""


def wait_ready(timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            urllib.request.urlopen(BASE + "/", timeout=2).read(64)
            return True
        except Exception:
            time.sleep(0.3)
    return False


def post_file(name: str, data: bytes):
    req = urllib.request.Request(
        f"{BASE}/api/load?name={name}", data=data,
        headers={"Content-Type": "application/octet-stream"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status, json.loads(r.read())


def get(path: str):
    try:
        with urllib.request.urlopen(BASE + path, timeout=120) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:300]
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, body


def main() -> int:
    tmp = Path(tempfile.gettempdir()) / "orbit-search-test"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True, exist_ok=True)

    env = dict(os.environ)
    env["PYTHONPATH"] = str(ROOT / "src")
    env["ORBIT_OFFLINE"] = "1"   # 别去连 UCSC
    env["IGV_DEBUG"] = "1"
    logf = open(tmp / "server.log", "wb")
    proc = subprocess.Popen(
        [sys.executable, "-m", "igvlocal", "--data", str(tmp),
         "--port", str(PORT), "--no-browser"],
        cwd=str(ROOT), env=env,
        stdout=subprocess.DEVNULL, stderr=logf)
    ok = True
    try:
        if not wait_ready():
            print("FAIL: 服务没起来")
            err = proc.stderr.read().decode("utf-8", "replace")[-800:] if proc.stderr else ""
            print(err)
            return 2

        st, res = post_file("braker.gff3", GFF3.encode())
        print("load:", st, "track id =", res.get("track", {}).get("id"),
              "name =", res.get("track", {}).get("name"),
              "kind =", res.get("track", {}).get("kind"))
        tid = res.get("track", {}).get("id") or ""
        if st != 200:
            print("FAIL: 导入失败", res)
            return 2

        # 1) 全部导入：前缀 g149
        st, r = get("/api/loaded/search?db=__custom__&q=g149&track=all")
        hits = r.get("hits", []) if isinstance(r, dict) else []
        print(f"all  g149 -> {st}, {len(hits)} hits:", [h.get("name") for h in hits])
        ok &= (st == 200 and len(hits) == 3)

        # 2) 精确 g14980
        st, r = get("/api/loaded/search?db=__custom__&q=g14980&track=all")
        hits = r.get("hits", []) if isinstance(r, dict) else []
        print(f"all  g14980 -> {st}, {len(hits)} hits:", [h.get("name") for h in hits])
        ok &= (st == 200 and any(h.get("name") == "g14980" for h in hits))

        # 3) 指定轨道 id（前端 scope 选某条轨道时用）
        st, r = get(f"/api/loaded/search?db=__custom__&q=g14980&track={urllib.parse.quote(tid)}")
        hits = r.get("hits", []) if isinstance(r, dict) else []
        print(f"tid  g14980 -> {st}, {len(hits)} hits:", [h.get("name") for h in hits])
        ok &= (st == 200 and len(hits) >= 1)

        # 4) 内置范围（/api/search）在自定义装配下应 200 空命中，不能 404
        st, r = get("/api/search?db=__custom__&q=g14980")
        print(f"builtin search -> {st},", (r.get("hits") if isinstance(r, dict) else r))
        ok &= (st == 200)

        # 5) 染色体名不应被错误改写（自定义装配直接用注释里的 chr_x）
        st, r = get("/api/loaded/search?db=__custom__&q=g14980&track=all")
        hits = r.get("hits", []) if isinstance(r, dict) else []
        print("chrom =", hits[0].get("chrom") if hits else None)
        ok &= bool(hits) and hits[0].get("chrom") == "chr_x"

        print("RESULT:", "PASS" if ok else "FAIL")
        if not ok:
            try:
                logf.flush()
                txt = (tmp / "server.log").read_text(encoding="utf-8", errors="replace")
                print("---- server.log tail ----")
                print(txt[-2000:])
            except Exception:
                pass
        return 0 if ok else 1
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
