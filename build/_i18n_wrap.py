"""把 app.js 里的中文字面量包成 T(...)，让 i18n.js 的词典接管。

规则（保守）：
  * 纯字符串字面量：**只有整串命中词典**才包，避免误包片段；
  * 含 ``${}`` 的模板字面量：一律包（t() 未命中时原样返回，无害），
    嵌套在 ``${}`` 里的字面量递归处理；
  * 已经包过的（前面紧邻 ``T(``）跳过，脚本可重复执行。

插入 ``T(`` / ``)`` 都是纯插入操作，按偏移从大到小应用即可，不会互相干扰。
"""

from __future__ import annotations

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import _jsscan as J

APP = pathlib.Path("src/web/app.js")
I18N = pathlib.Path("src/web/i18n.js")

# 从 i18n.js 里把词典的键抓出来（避免两份清单不同步）
def dict_keys() -> set[str]:
    src = I18N.read_text(encoding="utf-8")
    body = src.split("var EN = {", 1)[1].split("\n  };", 1)[0]
    keys = set()
    for m in re.finditer(r"^\s{4}(?:'((?:\\.|[^'\\])*)'|([A-Za-z_$][\w$]*))\s*:", body, re.M):
        k = m.group(1) if m.group(1) is not None else m.group(2)
        keys.add(k.replace("\\'", "'").replace('\\"', '"'))
    return keys


def main() -> int:
    src = APP.read_text(encoding="utf-8")
    keys = dict_keys()
    print(f"词典条目 {len(keys)}")

    lits = list(J.all_lits(J.scan(src)))
    inserts: list[tuple[int, int, str]] = []   # (位置, 长度, 文本)
    wrapped = skipped = 0

    for lit in lits:
        if not J.has_cjk(lit.body):
            continue
        is_tpl = lit.quote == "`"
        has_expr = is_tpl and "${" in lit.body
        if has_expr:
            ok = True
        elif is_tpl:
            ok = lit.body in keys
        else:
            ok = lit.body in keys
        if not ok:
            skipped += 1
            continue
        # 已经包过就跳过（幂等）
        head = src[:lit.start].rstrip()
        if head.endswith("T("):
            continue
        inserts.append((lit.start, 0, "T("))
        inserts.append((lit.end, 0, ")"))
        wrapped += 1

    for pos, _, text in sorted(inserts, key=lambda x: -x[0]):
        src = src[:pos] + text + src[pos:]

    # 在 IIFE 顶部加别名（T 在 app.js 里没有被当作标识符用过）
    anchor = "  const $$ = (sel) => Array.from(document.querySelectorAll(sel));\n"
    if anchor in src and "const T = " not in src:
        src = src.replace(anchor, anchor + "\n  // 界面文案：中文原文 → 当前语言（见 i18n.js）\n"
                                          "  const T = (s) => window.I18N.t(s);\n", 1)

    APP.write_text(src, encoding="utf-8")
    print(f"包裹 {wrapped} 处，跳过 {skipped} 处（词典里没有）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
