from __future__ import annotations

import argparse

from ..config import load_settings
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

    settings = load_settings()
    if args.force:
        result = install_prebuilt(force=True)
    else:
        from ..tools.ffmpeg import get_ffmpeg_info

        info = get_ffmpeg_info(settings)
        if info["ok"]:
            result = {"downloaded": False, **info}
        elif str(settings.get("ffmpeg", {}).get("executable_path") or "").strip():
            result = {"ok": False, "error": info.get("error")}
        else:
            result = ensure_prebuilt_runtime(settings)
    if result["ok"]:
        print(f"ffmpeg 就绪：{result['ffmpeg']}")
        if result.get("package_manager"):
            print(f"安装方式：{result['package_manager']}")
        if result.get("brew_ffmpeg_version"):
            print(f"brew info ffmpeg 最新版本：{result['brew_ffmpeg_version']}")
        print("编码器：" + "、".join(result.get("encoders", [])))
    else:
        print(f"失败：{result.get('error')}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
