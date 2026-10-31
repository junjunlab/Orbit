#!/usr/bin/env python3
"""把 Orbit 整窗截图裁成紧凑的文档配图：去掉中部/底部的大片空白画布。

用法: python tools/crop_fig.py <in.png> <out.png> [margin_px=24]
策略:
  - 背景色取左上角 (2,2) 像素
  - 从上往下逐行扫描；记录「连续空白行」的起始位置
  - 一旦遇到一段连续 >= GAP px 的空白（即 reads 面板下方预留的空画布），
    就把它作为裁剪底线（状态栏那一段短空白一并裁掉）
  - 右侧同理裁掉空白列
"""
import sys
from PIL import Image

GAP = 200  # 连续空白超过这个像素数就认定是「大块预留空白」，在此裁剪

def main():
    if len(sys.argv) < 3:
        print("usage: crop_fig.py <in> <out> [margin]"); sys.exit(1)
    inp, outp = sys.argv[1], sys.argv[2]
    margin = int(sys.argv[3]) if len(sys.argv) > 3 else 24
    im = Image.open(inp).convert("RGB")
    W, H = im.size
    px = im.load()
    bg = px[2, 2]
    def diff(c): return abs(c[0]-bg[0]) + abs(c[1]-bg[1]) + abs(c[2]-bg[2])
    thr = 40
    stepx = max(1, W // 240)

    def row_frac(y):
        cnt = 0; n = 0
        for x in range(0, W, stepx):
            n += 1
            if diff(px[x, y]) > thr: cnt += 1
        return cnt / n if n else 0.0

    # 从上往下找「第一个长空白带」的起始行
    bottom = H
    in_gap = False
    gap_start = H
    content_seen = False
    for y in range(0, H):
        f = row_frac(y)
        if f > 0.03:
            content_seen = True
            in_gap = False
        else:
            if content_seen and not in_gap:
                in_gap = True; gap_start = y
            elif in_gap:
                if y - gap_start >= GAP:
                    bottom = gap_start + margin
                    break
    # 若全程没出现长空白带，则 crop 到最后一个有内容的行
    if bottom == H:
        for y in range(H - 1, -1, -1):
            if row_frac(y) > 0.03:
                bottom = y + margin; break

    # 右侧空白列
    right = W
    for x in range(W - 1, -1, -1):
        cnt = 0; n = 0
        stepy = max(1, H // 400)
        for y in range(0, H, stepy):
            n += 1
            if diff(px[x, y]) > thr: cnt += 1
        if cnt / n > 0.03:
            right = x + margin; break

    out = im.crop((0, 0, right, bottom))
    out.save(outp)
    print(f"cropped {inp} {im.size} -> {out.size}  (box=0,0,{right},{bottom})")

if __name__ == "__main__":
    main()
