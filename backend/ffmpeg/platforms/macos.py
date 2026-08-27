from __future__ import annotations

import logging
import os
import platform
import re
import shutil
import sys
import urllib.request
from pathlib import Path
from typing import Any

from ..common import (
    DEFAULT_DOWNLOAD_DIR,
    _install_configured_prebuilt,
    _persist_system_path,
    _run_command,
    _verify_ffmpeg_binaries,
)


logger = logging.getLogger(__name__)

HOMEBREW_INSTALL_URL = (
    "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh"
)
HOMEBREW_BIN_CANDIDATES = (
    Path("/opt/homebrew/bin/brew"),
    Path("/usr/local/bin/brew"),
)


def install_macos_ffmpeg(
    settings: dict[str, Any],
    key: str,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Install macOS ffmpeg from a configured archive or Homebrew."""
    urls = settings.get("ffmpeg", {}).get("prebuilt_urls", {})
    if str(urls.get(key) or "").strip():
        return _install_configured_prebuilt(
            settings,
            key,
            force=force,
            missing_hint="可在设置页填写自定义 ffmpeg 路径。",
        )

    return _install_macos_ffmpeg_with_homebrew()


def install_homebrew(*, run_maintenance: bool = True) -> dict[str, Any]:
    """Install Homebrew on macOS when missing, then optionally update/upgrade it."""
    try:
        if platform.system() != "Darwin":
            return {"ok": False, "error": "Homebrew 自动安装仅支持 macOS"}

        brew_path = _find_homebrew()
        if not brew_path:
            _confirm_interactive(
                "未检测到 Homebrew。安装 Homebrew 可能需要管理员权限并触发 sudo 密码输入，是否继续？"
            )
            _run_command(["sudo", "-v"], capture_output=False, timeout=120)
            installer = DEFAULT_DOWNLOAD_DIR / "homebrew-install.sh"
            _download_homebrew_installer(installer)
            env = os.environ.copy()
            _run_command(
                ["/bin/bash", str(installer)],
                capture_output=False,
                env=env,
                timeout=1800,
            )
            brew_path = _find_homebrew()
            installed_homebrew = True
            if not brew_path:
                return {
                    "ok": False,
                    "error": "Homebrew 安装完成后仍未找到 brew 可执行文件",
                }
        else:
            installed_homebrew = False

        env = _homebrew_env(brew_path)
        if run_maintenance:
            _confirm_interactive(
                "将执行 brew update 和 brew upgrade 更新 Homebrew 及已安装包，是否继续？"
            )
            _run_command(
                [str(brew_path), "update"],
                capture_output=False,
                env=env,
                timeout=900,
            )
            _run_command(
                [str(brew_path), "upgrade"],
                capture_output=False,
                env=env,
                timeout=3600,
            )

        return {
            "ok": True,
            "brew": str(brew_path),
            "installed_homebrew": installed_homebrew,
        }
    except Exception as exc:  # noqa: BLE001 - 命令行脚本需要输出友好错误
        logger.exception("Homebrew 安装或更新失败")
        return {"ok": False, "error": f"Homebrew 安装或更新失败：{exc}"}


def _install_macos_ffmpeg_with_homebrew() -> dict[str, Any]:
    try:
        homebrew = install_homebrew(run_maintenance=True)
        if not homebrew.get("ok"):
            return {
                "ok": False,
                "downloaded": False,
                "error": str(homebrew.get("error") or "Homebrew 安装失败"),
            }

        brew_path = Path(str(homebrew["brew"]))
        env = _homebrew_env(brew_path)
        info = _run_command(
            [str(brew_path), "info", "ffmpeg"],
            env=env,
            timeout=120,
        )
        brew_version = _parse_brew_ffmpeg_version(info.stdout)
        _confirm_interactive(
            f"将通过 Homebrew 安装或更新 ffmpeg"
            f"{f'（brew info 最新版本：{brew_version}）' if brew_version else ''}，是否继续？"
        )
        try:
            _run_command(
                [str(brew_path), "install", "ffmpeg"],
                capture_output=False,
                env=env,
                timeout=3600,
            )
        except RuntimeError as exc:
            if "already installed" not in str(exc):
                raise
            _run_command(
                [str(brew_path), "upgrade", "ffmpeg"],
                capture_output=False,
                env=env,
                timeout=3600,
            )
        paths = _homebrew_ffmpeg_paths(brew_path)
    except Exception as exc:  # noqa: BLE001 - 启动流程需要把错误序列化
        logger.exception("macOS Homebrew ffmpeg 安装失败")
        return {
            "ok": False,
            "downloaded": False,
            "error": f"macOS Homebrew ffmpeg 安装失败：{exc}",
        }

    verified = _verify_ffmpeg_binaries(
        paths["ffmpeg"],
        paths["ffprobe"],
        missing_message="Homebrew 已执行安装，但未找到 ffmpeg/ffprobe",
        error_prefix="Homebrew ffmpeg 不可用",
    )
    if not verified["ok"]:
        return {
            "ok": False,
            "downloaded": False,
            "error": verified.get("error", "Homebrew ffmpeg 校验失败"),
            "encoders": verified.get("encoders", []),
            "missing_encoders": verified.get("missing_encoders", []),
        }

    _persist_system_path(paths["ffmpeg"])
    return {
        "ok": True,
        "downloaded": False,
        "package_manager": "homebrew",
        "installed_homebrew": homebrew.get("installed_homebrew", False),
        "brew": str(brew_path),
        "brew_ffmpeg_version": brew_version,
        "ffmpeg": str(paths["ffmpeg"]),
        "ffprobe": str(paths["ffprobe"]),
        **verified,
    }


def _find_homebrew() -> Path | None:
    candidates: list[Path] = []
    found = shutil.which("brew")
    if found:
        candidates.append(Path(found))
    candidates.extend(HOMEBREW_BIN_CANDIDATES)

    seen: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.expanduser()
        if resolved in seen:
            continue
        seen.add(resolved)
        if resolved.is_file() and os.access(resolved, os.X_OK):
            return resolved
    return None


def _confirm_interactive(message: str) -> None:
    if not sys.stdin.isatty():
        raise RuntimeError(
            "当前运行环境没有可交互终端，无法确认安装或输入 sudo 密码。"
            "请在终端运行 python -m backend.ffmpeg，或先手动安装 Homebrew/ffmpeg。"
        )
    answer = input(f"{message} [y/N] ").strip().lower()
    if answer not in {"y", "yes"}:
        raise RuntimeError("用户取消 macOS ffmpeg/Homebrew 安装")


def _homebrew_env(brew_path: Path) -> dict[str, str]:
    env = os.environ.copy()
    brew_bin = str(brew_path.parent)
    env["PATH"] = brew_bin + os.pathsep + env.get("PATH", "")
    return env


def _download_homebrew_installer(dest: Path) -> None:
    logger.info("下载 Homebrew 安装脚本：%s", HOMEBREW_INSTALL_URL)
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        HOMEBREW_INSTALL_URL,
        headers={"User-Agent": "wavebank-otakus"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response, open(  # noqa: SCS123
            dest,
            "wb",
        ) as output:
            shutil.copyfileobj(response, output)
        dest.chmod(0o755)
    except Exception:
        dest.unlink(missing_ok=True)
        raise


def _parse_brew_ffmpeg_version(info_output: str) -> str | None:
    for line in info_output.splitlines():
        match = re.search(r"^==> ffmpeg: stable ([^,\s]+)", line.strip())
        if match:
            return match.group(1)
    return None


def _homebrew_ffmpeg_paths(brew_path: Path) -> dict[str, Path]:
    env = _homebrew_env(brew_path)
    prefix = _run_command(
        [str(brew_path), "--prefix"],
        env=env,
        timeout=30,
    ).stdout.strip()
    return {
        "ffmpeg": Path(prefix) / "bin" / "ffmpeg",
        "ffprobe": Path(prefix) / "bin" / "ffprobe",
    }
