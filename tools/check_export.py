"""导出件与窗口内容的一致性校验。

用法：python tools/check_export.py [导出目录]
默认检查 docs/examples/_export 下最新的 png/svg/pdf，并和同目录的
_view-crop.png（浏览器里 #view 区域的截图，DPR 2）逐像素比对。

检查项：
  1. PNG 尺寸 == 视图区域 ×2，且与窗口截图高度接近、逐像素差异很小
  2. SVG 尺寸、文字条目（轨道名/坐标）、路径条目，且路径里没有 NaN
  3. PDF 页面尺寸、内嵌字体、ToUnicode、是否混入了位图（不应该有）
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "examples" / "_export"


def find(ext: str) -> Path:
    files = [f for f in DIR.glob(f"*{ext}") if not f.name.startswith("_")]
    files.sort(key=lambda p: p.stat().st_mtime)
    if not files:
        raise SystemExit(f"没有找到 {ext}")
    return files[-1]


def compare_png(shot: Path, out: Path) -> bool:
    a = Image.open(shot).convert("RGB")
    b = Image.open(out).convert("RGB")
    print(f"PNG  窗口截图 {a.width}×{a.height} / 导出 {b.width}×{b.height}")
    if abs(a.width - b.width) > 2:
        print(f"  ✗ 宽度不一致（差 {a.width - b.width}px）")
        return False
    w = min(a.width, b.width)
    h = min(a.height, b.height)
    # 导出图可能比窗口少几行像素（窗口里视口比轨道总高更高），按最小公共区域比对
    a2, b2 = a.crop((0, 0, w, h)), b.crop((0, 0, w, h))
    diff = ImageChops.difference(a2, b2).convert("L")
    hist = diff.histogram()
    total = w * h
    off = sum(hist[10:])
    mean = sum(i * n for i, n in enumerate(hist)) / total
    print(f"  重叠区域 {w}×{h}：平均灰度差 {mean:.2f}，>10 的像素 {off / total * 100:.2f}%")
    ok = mean < 4 and off / total < 0.02
    print("  " + ("✓ 内容一致" if ok else "✗ 与窗口差异过大"))
    return ok


def check_svg(p: Path) -> bool:
    txt = p.read_text(encoding="utf-8")
    m = re.search(r'width="([\d.]+)" height="([\d.]+)"', txt)
    w, h = (float(m.group(1)), float(m.group(2))) if m else (0, 0)
    texts = re.findall(r"<text[^>]*>([^<]*)</text>", txt)
    paths = txt.count("<path")
    bad = "NaN" in txt or "Infinity" in txt
    want = ["Coverage", "Junctions", "Alignments", "RefSeq"]
    missing = [t for t in want if not any(t in x for x in texts)]
    coords = [t for t in texts if re.match(r"^[\d,]+$", t.strip())]
    print(f"SVG  {w:.0f}×{h:.0f}，文字 {len(texts)} 条，路径 {paths} 条")
    print(f"  轨道名：{'✓' if not missing else '✗ 缺 ' + ','.join(missing)}；坐标文字 {len(coords)} 条")
    if bad:
        print("  ✗ 路径里出现 NaN/Infinity")
    return not missing and not bad and paths > 20 and len(coords) >= 3


def check_pdf(p: Path) -> bool:
    raw = p.read_bytes()
    txt = raw.decode("latin-1")
    pages = len(re.findall(r"/Type\s*/Page[^s]", txt)) or 1
    fonts = len(re.findall(r"/FontFile2|/FontFile3", txt))
    tounicode = txt.count("/ToUnicode")
    images = len(re.findall(r"/Subtype\s*/Image", txt))
    m = re.search(r"/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)", txt)
    box = [float(x) for x in m.groups()] if m else []
    print(f"PDF  {p.stat().st_size / 1024:.0f} KB，页面 {pages}，内嵌字体 {fonts}，ToUnicode {tounicode}，位图 {images}")
    if box:
        print(f"  页面尺寸 {box[2] - box[0]:.0f}×{box[3] - box[1]:.0f} pt")
    ok = pages >= 1 and fonts >= 1 and tounicode >= 1 and images == 0
    print("  " + ("✓ 纯矢量 + 内嵌字体" if ok else "✗ 结构不符合预期"))
    return ok


def main() -> int:
    shot = DIR / "_view-crop.png"
    if not shot.exists():
        shot = ROOT / "docs" / "examples" / "_view-crop.png"
    results = []
    if shot.exists():
        results.append(compare_png(shot, find(".png")))
    else:
        print("! 没有 _view-crop.png，跳过逐像素比对")
    results.append(check_svg(find(".svg")))
    results.append(check_pdf(find(".pdf")))
    print("\n" + ("全部通过" if all(results) else "有检查项未通过"))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
