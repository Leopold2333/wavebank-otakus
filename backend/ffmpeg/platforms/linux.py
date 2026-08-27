from __future__ import annotations

from typing import Any

from ..common import _install_configured_prebuilt


def install_linux_ffmpeg(
    settings: dict[str, Any],
    key: str,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Install Linux ffmpeg from the configured prebuilt archive."""
    return _install_configured_prebuilt(
        settings,
        key,
        force=force,
        missing_hint="可在 config/defaults.json 配置 Linux 预编译包下载地址，或在设置页填写自定义 ffmpeg 路径。",
    )
