"""PyInstaller entry point for the packaged desktop app."""
import sys

from igvlocal.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
