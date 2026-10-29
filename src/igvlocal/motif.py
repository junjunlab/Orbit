"""Find motif —— 对应 IGV 的 Tools → Find Motif。

实现刻意对齐 IGV 的 ``MotifFinderDialog`` / ``MotifFinderSource``：

* 输入按行拆，**每行一套 pattern**，各生成一对（正链 / 负链）轨道。
* 每行先按 IUPAC 简并碱基校验（表与 IGV 的 ``iupac_regex_table.txt`` 一致），
  通过就逐字符展开成正则；否则再按「只含 ACGTN 字母的正则」校验，通过就原样使用。
  两条都不满足 → 报错（和 IGV 的提示语一致）。
* 大小写不敏感。
* **允许重叠匹配**：IGV 每次匹配后从 ``lastMatchStart + 1`` 继续找，
  所以 ``ATATAT`` 里 ``TAT`` 能找到 2 次。这里用零宽前瞻实现同样的语义。
* 负链 = 把序列反向互补后搜，再把坐标映射回正链。
* 单次搜索窗口 10 Mb（IGV 的 ``featureWindowSize``）。
"""

from __future__ import annotations

import re

# 与 IGV resources/iupac_regex_table.txt 完全一致（连字母本身都保留在字符类里，
# 这样序列里带简并碱基时也能匹配）
IUPAC_RE = {
    "G": "G", "A": "A", "T": "T", "C": "C",
    "R": "[RGA]", "Y": "[YTC]", "M": "[MAC]", "K": "[KGT]",
    "S": "[SGC]", "W": "[WAT]", "H": "[HACT]", "B": "[BGTC]",
    "V": "[VGCA]", "D": "[DGAT]", "N": ".",
}

VALID_BASES = set("ACGTN")

MAX_PATTERN = 200
MAX_SPAN = 10_000_000     # IGV MotifFinderSource.featureWindowSize
MAX_HITS = 50_000
VISIBILITY_WINDOW = 1_000_000   # IGV MotifTrack.setVisibilityWindow(1e6)

_COMP = str.maketrans("ACGTNacgtn", "TGCANtgcan")


class MotifError(ValueError):
    """用户输入有误（前端直接把 message 弹给用户）。"""


def revcomp(seq: str) -> str:
    return seq.translate(_COMP)[::-1]


def is_iupac(p: str) -> bool:
    return bool(p) and all(c in IUPAC_RE for c in p.upper())


def iupac_to_regex(p: str) -> str:
    return "".join(IUPAC_RE[c] for c in p.upper())


def is_nucleotide_regex(p: str) -> bool:
    """IGV 的 checkNucleotideRegex：能编译，且所有字母都只能是 ACGTN。"""
    try:
        re.compile(p)
    except re.error:
        return False
    return all((not c.isalpha()) or c.upper() in VALID_BASES for c in p)


def compile_pattern(pattern: str) -> tuple[re.Pattern, str, str]:
    """返回 (编译好的正则, 'iupac'|'regex', 实际使用的正则字符串)。"""
    p = (pattern or "").strip()
    if not p:
        raise MotifError("请填写要查找的序列或正则")
    if len(p) > MAX_PATTERN:
        raise MotifError(f"表达式太长（最多 {MAX_PATTERN} 个字符）")
    if is_iupac(p):
        rx_str = iupac_to_regex(p)
        return re.compile(rx_str, re.IGNORECASE), "iupac", rx_str
    if is_nucleotide_regex(p):
        return re.compile(p, re.IGNORECASE), "regex", p
    raise MotifError(
        "不是合法的查找模式：\n"
        "· IUPAC 简并碱基写法不能含特殊字符（例如 AARNNR）\n"
        "· 正则写法除特殊字符外只能是 ACGTN（例如 TATAAA(A){3,}）"
    )


def _scan(rx: re.Pattern, seq: str):
    """找出所有匹配起点（允许重叠），产出 (start, end, match_text)。"""
    # 零宽前瞻：finditer 每次只前进 1 个字符，和 IGV 从 lastMatchStart+1 重来找等价
    for m in re.finditer(f"(?=({rx.pattern}))", seq, rx.flags):
        text = m.group(1)
        if text:
            yield m.start(), m.start() + len(text), text


def find_motif(seq: str, pattern: str, offset: int = 0,
               both_strands: bool = True, max_hits: int = MAX_HITS) -> dict:
    """在 ``seq`` 里找 pattern，坐标加上 ``offset``（该段在染色体上的起点）。

    返回 ``{hits: [{s, e, strand, match}], truncated, mode, regex, scanned}``。
    s/e 是 0-based 半开区间，hits 按起点升序。
    """
    rx, mode, rx_str = compile_pattern(pattern)
    hits: list[dict] = []
    truncated = False

    for s, e, text in _scan(rx, seq):
        hits.append({"s": offset + s, "e": offset + e, "strand": "+", "match": text.upper()})
        if len(hits) >= max_hits:
            truncated = True
            break

    if both_strands and not truncated:
        L = len(seq)
        rc = revcomp(seq)
        for s, e, text in _scan(rx, rc):
            # 反链上的 [s, e) 映射回正链坐标
            hits.append({"s": offset + (L - e), "e": offset + (L - s), "strand": "-",
                         "match": revcomp(text).upper()})
            if len(hits) >= max_hits:
                truncated = True
                break

    hits.sort(key=lambda h: (h["s"], h["e"]))
    return {"hits": hits, "truncated": truncated, "mode": mode,
            "regex": rx_str, "scanned": len(seq)}
