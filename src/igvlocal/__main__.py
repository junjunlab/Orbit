"""Entry point: ``python -m igvlocal`` or the packaged Orbit.exe."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _frozen_logging() -> None:
    """--windowed 打包没有控制台：把 stdout/stderr 落到 ``%LOCALAPPDATA%\\Orbit\\orbit.log``。

    页面里的 JS 异常另外走 ``<data>/client.log``（见 server 的 /api/clientlog），
    这两个文件合起来就是桌面版的全部排错信息。"""
    if not getattr(sys, "frozen", False):
        return
    try:
        from .qtwin import state_dir

        path = state_dir() / "orbit.log"
        if path.exists() and path.stat().st_size > (2 << 20):
            path.replace(path.with_name("orbit.log.1"))
        stream = open(path, "a", encoding="utf-8", buffering=1)
    except Exception:  # noqa: BLE001
        return
    sys.stdout = stream
    sys.stderr = stream


def main() -> int:
    from .server import run

    _frozen_logging()

    ap = argparse.ArgumentParser(prog="orbit", description="Orbit - offline genome browser")
    ap.add_argument("--data", type=Path, default=None, help="data directory")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--browser", action="store_true",
                    help="open in the system browser instead of a native window")
    ap.add_argument("--no-browser", action="store_true",
                    help="only start the server, do not open any window")
    ap.add_argument("--debug", action="store_true",
                    help="enable the WebView devtools / verbose log")
    args = ap.parse_args()

    mode = "window"
    if args.no_browser:
        mode = "none"
    elif args.browser:
        mode = "browser"
    return run(args.data, args.host, args.port, mode=mode, debug=args.debug) or 0


if __name__ == "__main__":
    sys.exit(main())
