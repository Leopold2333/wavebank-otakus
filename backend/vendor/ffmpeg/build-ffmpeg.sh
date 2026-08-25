#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$ROOT_DIR/ffmpeg-9.0.1"
PREFIX_DIR="$ROOT_DIR/build"
BIN_DIR="$ROOT_DIR/bin"
JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "未找到 $SOURCE_DIR，请先解压 ffmpeg-9.0.1.tar.xz。" >&2
  exit 1
fi

mkdir -p "$PREFIX_DIR" "$BIN_DIR"

cd "$SOURCE_DIR"

if [[ ! -f "ffbuild/config.mak" ]]; then
  ./configure \
    --prefix="$PREFIX_DIR" \
    --bindir="$BIN_DIR" \
    --disable-doc \
    --disable-debug \
    --disable-network \
    --disable-programs \
    --disable-x86asm \
    --enable-ffmpeg \
    --enable-ffprobe \
    --disable-autodetect
fi

make -j"$JOBS"
make install

echo
echo "构建完成："
echo "  $BIN_DIR/ffmpeg"
echo "  $BIN_DIR/ffprobe"
