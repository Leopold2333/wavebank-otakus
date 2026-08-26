#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_VERSION="${FFMPEG_VERSION:-9.0.1}"
SOURCE_DIR="${FFMPEG_SOURCE_DIR:-$ROOT_DIR/ffmpeg-$DEFAULT_VERSION}"
JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"

if [[ ! -d "$SOURCE_DIR" ]]; then
  for candidate in "$ROOT_DIR"/ffmpeg-*; do
    if [[ -d "$candidate" && -f "$candidate/configure" ]]; then
      SOURCE_DIR="$candidate"
      break
    fi
  done
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "未找到 ffmpeg 源码目录，请先下载并解压 ffmpeg 源码。" >&2
  exit 1
fi

cd "$SOURCE_DIR"

if [[ ! -f "ffbuild/config.mak" ]]; then
  ./configure \
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

echo
echo "构建完成："
echo "  $SOURCE_DIR/ffmpeg"
echo "  $SOURCE_DIR/ffprobe"
