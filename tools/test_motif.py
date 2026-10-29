"""Find motif 后端的纯函数测试（不需要起服务器）。

    PYTHONPATH=src python tools/test_motif.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from igvlocal.motif import (  # noqa: E402
    MotifError,
    compile_pattern,
    find_motif,
    is_iupac,
    is_nucleotide_regex,
    revcomp,
)

passed = failed = 0


def ck(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  OK   {name}")
    else:
        failed += 1
        print(f"  FAIL {name}  {detail}")


def main() -> int:
    print("[1] IUPAC 展开（与 IGV iupac_regex_table.txt 一致）")
    ck("ACGT 原样", compile_pattern("ACGT")[2] == "ACGT", compile_pattern("ACGT")[2])
    ck("AARNNR", compile_pattern("AARNNR")[2] == "AA[RGA]..[RGA]", compile_pattern("AARNNR")[2])
    ck("N → .", compile_pattern("N")[2] == ".")
    ck("R 含自身", compile_pattern("R")[2] == "[RGA]")
    ck("mode=iupac", compile_pattern("ACGT")[1] == "iupac")
    ck("is_iupac 拒绝 X", not is_iupac("ACGTX"))
    ck("is_iupac 接受小写", is_iupac("acgtn"))

    print("\n[2] 正则判定（IGV checkNucleotideRegex：字母只能是 ACGTN）")
    ck("TATAAA(A){3,} 是正则", compile_pattern("TATAAA(A){3,}")[1] == "regex")
    ck("AC[GT] 是正则", compile_pattern("AC[GT]")[1] == "regex")
    ck("ACGTX 非法", not is_nucleotide_regex("ACGTX"))
    try:
        compile_pattern("ACGTX")
        ck("ACGTX 抛错", False)
    except MotifError:
        ck("ACGTX 抛错", True)
    try:
        compile_pattern("AC[GT")
        ck("坏正则抛错", False)
    except MotifError:
        ck("坏正则抛错", True)
    try:
        compile_pattern("   ")
        ck("空输入抛错", False)
    except MotifError:
        ck("空输入抛错", True)

    print("\n[3] 重叠匹配（IGV 从 lastMatchStart+1 继续找）")
    r = find_motif("TATAT", "TAT", both_strands=False)
    ck("TATAT 里 TAT 命中 2 次", [(h["s"], h["e"]) for h in r["hits"]] == [(0, 3), (2, 5)],
       r["hits"])
    r = find_motif("AAAA", "AAA", both_strands=False)
    ck("AAAA 里 AAA 命中 2 次", len(r["hits"]) == 2, r["hits"])

    print("\n[4] 负链坐标映射")
    seq = "AAAACGT"          # 反补 = ACGTTTT，含 ACGT 在 rc 的 0..4
    r = find_motif(seq, "ACGT", offset=100)
    plus = [h for h in r["hits"] if h["strand"] == "+"]
    minus = [h for h in r["hits"] if h["strand"] == "-"]
    # "AAAACGT" 里 ACGT 在 3..7；反向互补 "ACGTTTT" 里也在 0..4 → 映射回 3..7
    ck("正链命中 103..107", [(h["s"], h["e"]) for h in plus] == [(103, 107)], plus)
    ck("负链命中 103..107", [(h["s"], h["e"]) for h in minus] == [(103, 107)], minus)
    ck("match 序列正链化", all(h["match"] == "ACGT" for h in r["hits"]), [h["match"] for h in r["hits"]])

    print("\n[5] 偏移与排序")
    r = find_motif("GGGAAAGGG", "GGG", offset=1000, both_strands=False)
    ck("坐标带 offset", [h["s"] for h in r["hits"]] == [1000, 1006], [h["s"] for h in r["hits"]])
    r = find_motif("ACGTACGT", "ACG")
    s = [h["s"] for h in r["hits"]]
    ck("hits 升序", s == sorted(s), s)

    print("\n[6] 截断")
    r = find_motif("A" * 5000, "A", both_strands=False, max_hits=100)
    ck("max_hits 生效", len(r["hits"]) == 100 and r["truncated"] is True, len(r["hits"]))

    print("\n[7] revcomp")
    ck("revcomp", revcomp("ACGTN") == "NACGT", revcomp("ACGTN"))

    print(f"\n结果：{passed} 通过 / {failed} 失败")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
