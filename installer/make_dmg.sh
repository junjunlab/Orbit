#!/usr/bin/env bash
# Orbit — macOS 打包（.app → .dmg）
#   先跑：python build/make_exe.py --no-genomes --windowed
#   再跑：bash installer/make_dmg.sh
# 产物：dist/Orbit-<version>-macOS-<arch>.dmg
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${VERSION:-$(python -c 'import sys; sys.path.insert(0, "src"); import igvlocal; print(igvlocal.__version__)')}"
ARCH="$(uname -m)"
APP="$ROOT/dist/Orbit.app"

if [ ! -d "$APP" ]; then
  echo "!! $APP 不存在，先跑 python build/make_exe.py --no-genomes --windowed" >&2
  exit 1
fi

# Apple Silicon 上未签名的 arm64 二进制会被直接杀掉，所以至少做 ad-hoc 签名。
# （要消掉 Gatekeeper 的「无法验证开发者」，需要 Apple Developer 证书做正式签名 + 公证。）
echo "==> ad-hoc 签名"
codesign --force --deep --sign - "$APP"
xattr -cr "$APP" || true

STAGE="$ROOT/dist/dmg"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

OUT="$ROOT/dist/Orbit-${VERSION}-macOS-${ARCH}.dmg"
rm -f "$OUT"
echo "==> hdiutil 打包 -> $OUT"
hdiutil create -volname "Orbit" -srcfolder "$STAGE" -ov -format UDZO -quiet "$OUT"
rm -rf "$STAGE"

ls -lh "$OUT"
echo
echo "提示：DMG 从网上下载后带 quarantine 标记，首次打开需右键 → 打开，"
echo "      或执行 xattr -dr com.apple.quarantine /Applications/Orbit.app"
