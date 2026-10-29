#!/usr/bin/env python3
"""Generate Orbit app icons from the in-app logo design.

Produces:
  assets/orbit.png   1024x1024 master
  assets/orbit.ico   Windows multi-size (16..256)
  assets/orbit.icns  macOS (if Pillow supports ICNS on this platform)

Design mirrors src/web/index.html .logo: rounded grey tile, tilted orbit ring,
white chromosome bar with a centromere gap, and a small planet dot.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"
MASTER = 1024
SS = 4  # supersample factor


def _gradient(size: int) -> Image.Image:
    """Vertical gradient #6b7280 -> #374151."""
    top = (0x6B, 0x72, 0x80)
    bot = (0x37, 0x41, 0x51)
    grad = Image.new("RGB", (1, size))
    px = grad.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = (
            round(top[0] + (bot[0] - top[0]) * t),
            round(top[1] + (bot[1] - top[1]) * t),
            round(top[2] + (bot[2] - top[2]) * t),
        )
    return grad.resize((size, size), Image.BILINEAR)


def render(size: int = MASTER, simple: bool = False) -> Image.Image:
    W = size * SS
    canvas = Image.new("RGBA", (W, W), (0, 0, 0, 0))

    # Rounded-square tile with gradient fill.
    radius = round(W * 0.22)
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, W - 1, W - 1), radius=radius, fill=255)
    tile = _gradient(W).convert("RGBA")
    canvas.paste(tile, (0, 0), mask)

    d = ImageDraw.Draw(canvas)
    cx = cy = W / 2

    # Tilted orbit ring. Skipped on very small sizes, where it turns to mush.
    if not simple:
        ring = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        rd = ImageDraw.Draw(ring)
        rx, ry = W * 0.35, W * 0.17
        ring_w = max(2, round(W * 0.042))
        rd.ellipse(
            (cx - rx, cy - ry, cx + rx, cy + ry),
            outline=(255, 255, 255, 165),
            width=ring_w,
        )
        ring = ring.rotate(-30, resample=Image.BICUBIC, center=(cx, cy))
        canvas.alpha_composite(ring)

    # Chromosome bar (single solid rounded pill, centred) — matches the in-app logo.
    bar_w = W * (0.50 if simple else 0.42)
    bar_h = W * (0.20 if simple else 0.135)
    y0, y1 = cy - bar_h / 2, cy + bar_h / 2
    x0, x1 = cx - bar_w / 2, cx + bar_w / 2
    r = bar_h / 2
    d.rounded_rectangle((x0, y0, x1, y1), radius=r, fill=(255, 255, 255, 252))

    # Planet dot, in the upper-right. Larger on small sizes so it survives.
    pr = W * (0.075 if simple else 0.052)
    px_, py_ = cx + W * (0.27 if simple else 0.245), cy - W * (0.17 if simple else 0.155)
    d.ellipse((px_ - pr, py_ - pr, px_ + pr, py_ + pr), fill=(255, 255, 255, 255))

    return canvas.resize((size, size), Image.LANCZOS)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    master = render(MASTER)
    master.save(OUT / "orbit.png")
    print("wrote", OUT / "orbit.png", master.size)

    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    # Render each size from scratch; tiny sizes get the simplified silhouette.
    frames = [render(s[0], simple=s[0] <= 24).convert("RGBA") for s in sizes]
    ico_path = OUT / "orbit.ico"
    frames[-1].save(ico_path, format="ICO", sizes=sizes, append_images=frames[:-1])
    print("wrote", ico_path, ico_path.stat().st_size, "bytes", sizes)

    icns_path = OUT / "orbit.icns"
    try:
        master.save(icns_path, format="ICNS")
        print("wrote", icns_path, icns_path.stat().st_size, "bytes")
    except Exception as exc:  # pragma: no cover - platform dependent
        print("ICNS not generated:", exc)
    return 0


if __name__ == "__main__":
    sys.exit(main())
