"""校验导出的 PDF：xref 偏移正确、图像流能解压、像素数与 /Width /Height 相符。"""

from __future__ import annotations

import re
import sys
import zlib
from pathlib import Path


def main(path: str) -> None:
    raw = Path(path).read_bytes()
    print(f"size={len(raw)} bytes")
    assert raw.startswith(b"%PDF-1.4"), "bad header"
    assert raw.rstrip().endswith(b"%%EOF"), "bad trailer"

    m = re.search(rb"startxref\s+(\d+)", raw)
    xref = int(m.group(1))
    print(f"startxref={xref}  at->{raw[xref:xref + 4]!r}")
    assert raw[xref:xref + 4] == b"xref"

    block = raw[xref:].split(b"trailer")[0].decode("latin-1")
    lines = [ln for ln in block.splitlines() if ln.strip()]
    nums = [ln for ln in lines if re.match(r"^\d{10} \d{5} [nf]", ln)]
    print(f"xref entries={len(nums)}")
    for i, ln in enumerate(nums):
        off = int(ln[:10])
        if i == 0:
            continue
        want = f"{i} 0 obj".encode()
        got = raw[off:off + len(want)]
        assert got == want, f"obj {i} offset wrong: {got!r}"
    print("all object offsets OK")

    w = int(re.search(rb"/Width (\d+)", raw).group(1))
    h = int(re.search(rb"/Height (\d+)", raw).group(1))
    ln = int(re.search(rb"/Length (\d+)", raw).group(1))
    print(f"image {w}x{h}, want {w * h * 3} bytes, stream length={ln}")

    s = raw.index(b"stream\n", raw.index(b"/Subtype/Image")) + len(b"stream\n")
    data = raw[s:s + ln]
    px = zlib.decompress(data)
    print(f"inflated={len(px)}  match={len(px) == w * h * 3}")
    assert len(px) == w * h * 3
    print("PDF OK")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "shots/_export2.pdf")
