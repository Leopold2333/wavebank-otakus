from __future__ import annotations

import argparse

from .setup import (
    ensure_prebuilt_runtime,
    install_prebuilt,
    platform_key,
    prebuilt_binary_paths,
    prebuilt_binaries_ready,
    verify_prebuilt_binaries,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="WaveBank Otakus 内置 ffmpeg 预编译包管理")
    parser.add_argument(
        "--check",
        action="store_true",
        help="只检查当前平台的内置 ffmpeg 是否可用，不下载",
    )
    parser.add_argument(
        "--install",
        action="store_true",
        help="下载并安装当前平台的预编译 ffmpeg",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="已存在时仍重新下载安装",
    )
    args = parser.parse_args()

    if args.check:
        print(f"平台：{platform_key()}")
        paths = prebuilt_binary_paths()
        if not prebuilt_binaries_ready():
            print(f"内置 ffmpeg 未安装（预期位置：{paths['ffmpeg']}）")
            return
        verified = verify_prebuilt_binaries()
        print(f"ffmpeg：{paths['ffmpeg']}")
        print(f"ffprobe：{paths['ffprobe']}")
        if verified["ok"]:
            print(f"版本：{verified.get('version')}")
            print("编码器：" + "、".join(verified.get("encoders", [])))
        else:
            print(f"不可用：{verified.get('error')}")
            raise SystemExit(1)
        return

    if args.force:
        result = install_prebuilt(force=True)
    else:
        result = ensure_prebuilt_runtime()
    if result["ok"]:
        print(f"ffmpeg 就绪：{result['ffmpeg']}")
        print("编码器：" + "、".join(result.get("encoders", [])))
    else:
        print(f"失败：{result.get('error')}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
