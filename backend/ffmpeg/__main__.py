from __future__ import annotations

import argparse

from .setup import download_source, ensure_bundled_source, find_bundled_source


def main() -> None:
    parser = argparse.ArgumentParser(description="WaveBank Otakus ffmpeg 源码下载/检查")
    parser.add_argument("--version", default=None, help="ffmpeg 源码版本，例如 9.0.1")
    parser.add_argument(
        "--force",
        action="store_true",
        help="已存在源码时仍重新下载解压",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="只检查已解压的源码，不下载",
    )
    args = parser.parse_args()

    if args.check:
        source = find_bundled_source()
        print(str(source) if source else "未找到已解压的 ffmpeg 源码")
        return

    if args.force:
        source = download_source(version=args.version, force=True)
        print(f"源码就绪：{source}")
        return

    result = ensure_bundled_source(auto_download=True)
    if result["ok"]:
        print(f"源码就绪：{result['source']}")
    else:
        print(f"失败：{result.get('error')}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
