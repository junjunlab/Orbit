"""从回收站彻底清除本项目已确认删除的残留，真正释放磁盘。

严格白名单，按 `--only` 选择目标（默认 genomes）：

    genomes   <项目>/data/genomes/ 下的 .fasta / .parts（重建 2bit 的中间产物）
    oldbuilds <项目>/dist/_old_* 旧打包目录（已被当前 dist 取代）
    temp      <项目>/.chrome-* 、.cdp-profile（CDP 测试用的临时 Chrome 配置）与 __pycache__

其它回收站内容一律不碰。

用法：
    python tools/purge_recycle.py                       # 只报告（dry-run）
    python tools/purge_recycle.py --apply               # 真正删除 $R 数据 + $I 元数据
    python tools/purge_recycle.py --only oldbuilds      # 换目标
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from scan_recycle import ROOT, parse_index  # noqa: E402

GENOMES = "agent_devop_pkgs\\igv\\data\\genomes\\"
GENOME_SUFFIXES = (".fasta", ".parts")
OLDBUILD = "agent_devop_pkgs\\igv\\dist\\_old_"
CHROME_TMP = "agent_devop_pkgs\\igv\\.chrome-"
CDP_TMP = "agent_devop_pkgs\\igv\\.cdp-profile"


def match(orig: str, only: str) -> bool:
    low = orig.lower()
    if only == "genomes":
        return GENOMES in orig and low.endswith(GENOME_SUFFIXES)
    if only == "oldbuilds":
        return OLDBUILD in orig
    if only == "temp":
        return CHROME_TMP in orig or CDP_TMP in orig or low.endswith("__pycache__")
    return False


def collect(only: str) -> list[dict]:
    hits: list[dict] = []
    for sid_dir in ROOT.iterdir():
        if not sid_dir.is_dir():
            continue
        try:
            entries = list(sid_dir.iterdir())
        except OSError:
            continue
        for f in entries:
            if not f.name.startswith("$I"):
                continue
            info = parse_index(f)
            if not info or not match(info["orig"], only):
                continue
            info["index"] = f
            info["pair"] = sid_dir / ("$R" + f.name[2:])
            hits.append(info)
    return hits


def main() -> None:
    apply = "--apply" in sys.argv
    only = "genomes"
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]

    hits = collect(only)
    total = sum(h["size"] for h in hits)
    print(f"目标={only}  {'删除' if apply else '待删'}条目 {len(hits)} 个，合计 {total / 1e9:.2f} GB\n")

    freed = 0
    failed = []
    for h in hits:
        print(f"  {h['size'] / 1e9:6.2f} GB  {h['orig']}")
        if not apply:
            continue
        try:
            if h["pair"].exists():
                if h["pair"].is_dir():
                    shutil.rmtree(h["pair"])
                else:
                    h["pair"].unlink()
            if h["index"].exists():
                h["index"].unlink()
            freed += h["size"]
        except OSError as exc:  # noqa: BLE001
            failed.append((h["orig"], exc))

    if apply:
        print(f"\n实际释放 {freed / 1e9:.2f} GB")
        for orig, exc in failed:
            print(f"  失败 {orig}: {exc}")
        if not failed:
            print("  全部成功")


if __name__ == "__main__":
    main()
