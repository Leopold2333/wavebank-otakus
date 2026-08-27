from __future__ import annotations

from typing import Any

from ..config import load_settings
from .common import (
    DEFAULT_DOWNLOAD_DIR,
    DEFAULT_PREBUILT_DIR,
    REQUIRED_ENCODER_GROUPS,
    VENDOR_FFMPEG_DIR,
    executable_suffix,
    get_prebuilt_dir,
    missing_required_encoders,
    platform_key,
    prebuilt_binaries_ready,
    prebuilt_binary_paths,
    read_ffmpeg_encoders,
    verify_prebuilt_binaries,
    _persist_prebuilt_path,
)


def install_prebuilt(
    settings: dict[str, Any] | None = None,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Dispatch ffmpeg installation to the current platform installer."""
    settings = settings or load_settings()
    key = platform_key()
    system = key.split("-", 1)[0]

    if system == "linux":
        from .platforms.linux import install_linux_ffmpeg

        return install_linux_ffmpeg(settings, key, force=force)
    if system == "windows":
        from .platforms.windows import install_windows_ffmpeg

        return install_windows_ffmpeg(settings, key, force=force)
    if system == "darwin":
        from .platforms.macos import install_macos_ffmpeg

        return install_macos_ffmpeg(settings, key, force=force)

    return {
        "ok": False,
        "downloaded": False,
        "error": f"当前平台 {key} 暂不支持自动安装 ffmpeg，请在设置页填写自定义 ffmpeg 路径。",
    }


def ensure_prebuilt_runtime(
    settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Make sure a usable ffmpeg is installed; download prebuilt if missing."""
    settings = settings or load_settings()
    if prebuilt_binaries_ready(settings):
        verified = verify_prebuilt_binaries(settings)
        if verified["ok"]:
            paths = prebuilt_binary_paths(settings)
            _persist_prebuilt_path(paths["ffmpeg"])
            return {
                "ok": True,
                "downloaded": False,
                "ffmpeg": str(paths["ffmpeg"]),
                "ffprobe": str(paths["ffprobe"]),
                **verified,
            }
    return install_prebuilt(settings)
