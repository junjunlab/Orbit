"""极简 JS 字面量扫描器：找出字符串 / 模板字面量的精确区间。

只做一件事——正确跳过注释、正则字面量、以及模板字面量里 ``${...}`` 内的代码，
这样既不会把注释里的中文当成待翻译文本，也能递归处理模板字面量里的嵌套字面量。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

CJK = re.compile(r"[\u4e00-\u9fff]")


@dataclass
class Lit:
    start: int          # 含引号
    end: int            # 不含（指向收尾引号之后）
    quote: str          # ' " `
    body: str           # 引号内原文（模板字面量里含 ${...}）
    line: int
    nested: list        # 模板字面量 ${} 内部的字面量（递归）


def scan(src: str) -> list[Lit]:
    """返回顶层字面量列表（模板字面量的嵌套项在 .nested 里）。"""
    out: list[Lit] = []
    _scan(src, 0, len(src), out)
    return out


# 这些字符之后出现的 ``/`` 是正则字面量的开头，而不是除号
_REGEX_PREV = set("(,=:[!&|?{};+-*%~^<>")
# 这些关键字之后同理
_REGEX_KW = {"return", "typeof", "case", "in", "of", "new", "delete", "void",
             "do", "else", "instanceof", "yield", "await"}


def _regex_allowed(src: str, i: int) -> bool:
    """判断 src[i] == '/' 是正则开头还是除号。"""
    j = i - 1
    while j >= 0 and src[j] in " \t\r\n":
        j -= 1
    if j < 0:
        return True
    c = src[j]
    if c in _REGEX_PREV:
        return True
    if c.isalnum() or c in "_$":
        k = j
        while k >= 0 and (src[k].isalnum() or src[k] in "_$"):
            k -= 1
        return src[k + 1:j + 1] in _REGEX_KW
    return False


def _scan(src: str, i: int, end: int, out: list[Lit]) -> None:
    n = end
    while i < n:
        c = src[i]
        # 行注释
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        # 块注释
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        # 正则字面量：整段跳过（字符类里的引号最容易把扫描带偏）
        if c == "/" and _regex_allowed(src, i):
            j = i + 1
            in_class = False
            while j < n:
                ch = src[j]
                if ch == "\\":
                    j += 2
                    continue
                if ch == "[":
                    in_class = True
                elif ch == "]":
                    in_class = False
                elif ch == "/" and not in_class:
                    break
                elif ch == "\n":
                    break
                j += 1
            i = j + 1
            continue
        if c in "'\"":
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == c:
                    break
                j += 1
            out.append(Lit(i, min(j + 1, n), c, src[i + 1:j],
                           src.count("\n", 0, i) + 1, []))
            i = j + 1
            continue
        if c == "`":
            j = i + 1
            nested: list[Lit] = []
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "`":
                    break
                if src[j] == "$" and j + 1 < n and src[j + 1] == "{":
                    # 跳到配对的 }，沿途递归扫描其中的字面量
                    k = j + 2
                    depth = 1
                    while k < n and depth:
                        if src[k] == "{":
                            depth += 1
                        elif src[k] == "}":
                            depth -= 1
                        k += 1
                    _scan(src, j + 2, k - 1, nested)
                    j = k
                    continue
                j += 1
            out.append(Lit(i, min(j + 1, n), "`", src[i + 1:j],
                           src.count("\n", 0, i) + 1, nested))
            i = j + 1
            continue
        i += 1


def all_lits(lits: list[Lit]):
    """深度优先展开（含嵌套）。"""
    for lit in lits:
        yield lit
        yield from all_lits(lit.nested)


def has_cjk(s: str) -> bool:
    return bool(CJK.search(s))
