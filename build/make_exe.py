#!/usr/bin/env python3
"""把 Orbit 冻结成可直接运行的目录（Windows: dist/Orbit/，macOS: dist/Orbit.app）。

    python build/make_exe.py                 # 完整包（含 data/genomes 下的本地 2bit）
    python build/make_exe.py --no-genomes    # 不打包 *.2bit（序列走 UCSC 远程），安装包用这个
    python build/make_exe.py --no-data       # 完全不复制 data/（CI 里先手工放置）
    python build/make_exe.py --windowed      # 不显示控制台（正式发布）

产物：

    Windows  dist/Orbit/Orbit.exe + _internal/ + data/
    macOS    dist/Orbit.app/Contents/MacOS/{Orbit, _internal/, data/}
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
APP = DIST / "Orbit"                       # Windows 目录 / macOS 的 .app 源目录
MAC_APP = DIST / "Orbit.app"
IS_MAC = sys.platform == "darwin"


def build() -> None:
    import PyInstaller.__main__

    windowed = "--windowed" in sys.argv      # 去掉控制台黑框（正式发布用）
    # --add-data 的分隔符：Windows 是 ; ，macOS/Linux 是 :
    sep = ";" if os.name == "nt" else ":"
    args = [
        str(ROOT / "build" / "launcher.py"),
        "--name", "Orbit",
        "--onedir",
        "--noconfirm",
        "--clean",
        "--windowed" if windowed else "--console",
        "--add-data", f"{ROOT / 'src' / 'web'}{sep}web",
        "--add-data", f"{ROOT / 'assets'}{sep}assets",
        "--paths", str(ROOT / "src"),
        "--distpath", str(DIST),
        "--workpath", str(ROOT / "build" / "pyi"),
        "--specpath", str(ROOT / "build"),
        "--exclude-module", "numpy",
        "--exclude-module", "playwright",
        "--exclude-module", "tkinter",
        # 原生窗口走 Qt（PySide6 + QtWebEngine）。这些 import 写在函数里，
        # 显式点名更保险；QtWebEngine 的 resources/QtWebEngineProcess
        # 由 PyInstaller 自带的 PySide6 hook 收集。
        "--hidden-import", "PySide6.QtWebEngineWidgets",
        "--hidden-import", "PySide6.QtWebEngineCore",
        "--hidden-import", "PySide6.QtWebChannel",
    ]
    if IS_MAC:
        # 交给 .app 包一层，安装后能拖进 /Applications
        args += ["--osx-bundle-identifier", "io.github.junjunlab.orbit"]
    # 应用图标（Windows .ico / macOS .icns），由 build/make_icons.py 生成。
    icon = ROOT / "assets" / ("orbit.icns" if IS_MAC else "orbit.ico")
    if icon.exists():
        args += ["--icon", str(icon)]
    else:
        print(f"WARNING: icon not found at {icon}; building without a custom icon")
    print("running PyInstaller ...", flush=True)
    PyInstaller.__main__.run(args)


def data_root() -> Path:
    """数据该放哪儿：macOS 在 .app/Contents/MacOS 下（= sys.executable 的目录），
    Windows 在 Orbit/ 下。两边都是 server._base_dir() 的返回值。"""
    if IS_MAC and MAC_APP.exists():
        return MAC_APP / "Contents" / "MacOS"
    return APP


def copy_data(no_genomes: bool = False) -> None:
    src = ROOT / "data"
    dst = data_root() / "data"
    if dst.exists():
        shutil.rmtree(dst)
    (dst / "ann").mkdir(parents=True)
    (dst / "genomes").mkdir(parents=True)

    shutil.copy2(src / "catalog.json", dst / "catalog.json")
    total = 0
    for db_dir in sorted((src / "ann").iterdir()):
        if not db_dir.is_dir():
            continue
        target = dst / "ann" / db_dir.name
        target.mkdir(parents=True, exist_ok=True)
        for f in db_dir.iterdir():
            if f.is_file():
                shutil.copy2(f, target / f.name)
                total += f.stat().st_size
                print(f"  ann  {db_dir.name}/{f.name}  {f.stat().st_size/1e6:.1f} MB")
    # --no-genomes：只带注释。序列改走 catalog 里的 twoBitURL（UCSC 远程 2bit，
    # 按窗口 HTTP Range 读取），安装包因此从 ~3 GB 降到 ~70 MB。
    if no_genomes:
        print("  seq  (skipped: --no-genomes → 序列走 UCSC 远程)")
    else:
        for f in sorted((src / "genomes").glob("*.2bit")):
            shutil.copy2(f, dst / "genomes" / f.name)
            total += f.stat().st_size
            print(f"  seq  {f.name}  {f.stat().st_size/1e6:.0f} MB")

    print(f"data copied: {total/1e6:.1f} MB -> {dst}")


def main() -> None:
    build()
    if "--no-data" not in sys.argv:
        copy_data(no_genomes="--no-genomes" in sys.argv)
    exe = (MAC_APP / "Contents" / "MacOS" / "Orbit") if IS_MAC else (APP / "Orbit.exe")
    print("\ndone." if exe.exists() else f"\nWARNING: {exe} missing")
    if exe.exists():
        print(f"  {exe}")


if __name__ == "__main__":
    main()
