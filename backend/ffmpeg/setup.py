from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tarfile
import urllib.request
from pathlib import Path
from typing import Any

from ..config import PROJECT_ROOT, load_settings


logger = logging.getLogger(__name__)

DEFAULT_VENDOR_DIR = PROJECT_ROOT / "backend" / "vendor" / "ffmpeg"
DEFAULT_VERSION = "9.0.1"
DEFAULT_URL_TEMPLATE = "https://ffmpeg.org/releases/ffmpeg-{version}.tar.xz"


def executable_suffix() -> str:
    return ".exe" if os.name == "nt" else ""


def get_vendor_dir(settings: dict[str, Any] | None = None) -> Path:
    """Return the directory that contains ffmpeg source archives/extracted dirs."""
    return DEFAULT_VENDOR_DIR


def find_bundled_source(settings: dict[str, Any] | None = None) -> Path | None:
    """Find any extracted ffmpeg source directory, keeping its original name."""
    settings = settings or load_settings()
    vendor_dir = get_vendor_dir(settings)
    if not vendor_dir.is_dir():
        return None
    candidates = [
        path
        for path in vendor_dir.iterdir()
        if path.is_dir() and path.name.lower().startswith("ffmpeg-")
    ]
    candidates.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    for candidate in candidates:
        if (candidate / "configure").exists():
            return candidate
    return None


def bundled_binary_paths(settings: dict[str, Any] | None = None) -> dict[str, Path]:
    settings = settings or load_settings()
    vendor_dir = get_vendor_dir(settings)
    suffix = executable_suffix()
    source = find_bundled_source(settings)
    version = settings["ffmpeg"].get("source_version", DEFAULT_VERSION)
    source_dir = source or vendor_dir / f"ffmpeg-{version}"
    return {
        "ffmpeg": source_dir / f"ffmpeg{suffix}",
        "ffprobe": source_dir / f"ffprobe{suffix}",
    }


def bundled_binaries_ready(settings: dict[str, Any] | None = None) -> bool:
    paths = bundled_binary_paths(settings)
    return paths["ffmpeg"].is_file() and paths["ffprobe"].is_file()


def _find_local_archive(
    version: str,
    settings: dict[str, Any] | None = None,
) -> Path | None:
    vendor_dir = get_vendor_dir(settings)
    candidates = [
        vendor_dir / f"ffmpeg-{version}.tar.xz",
        PROJECT_ROOT / f"ffmpeg-{version}.tar.xz",
    ]
    if version == DEFAULT_VERSION:
        candidates.append(PROJECT_ROOT / "ffmpeg-9.0.1.tar.xz")
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def _safe_extract(archive_path: Path, destination: Path) -> None:
    with tarfile.open(archive_path, "r:xz") as archive:
        for member in archive.getmembers():
            resolved = (destination / member.name).resolve()
            if not resolved.is_relative_to(destination.resolve()):
                raise ValueError(f"压缩包包含非法路径：{member.name}")
        archive.extractall(destination)


def download_source(
    version: str | None = None,
    *,
    force: bool = False,
    settings: dict[str, Any] | None = None,
) -> Path:
    """Download (or reuse a local archive) and extract ffmpeg source into vendor dir."""
    settings = settings or load_settings()
    version = version or str(settings["ffmpeg"].get("source_version", DEFAULT_VERSION))
    vendor_dir = get_vendor_dir(settings)
    vendor_dir.mkdir(parents=True, exist_ok=True)

    existing = find_bundled_source(settings)
    if existing and not force:
        return existing

    archive_path = _find_local_archive(version, settings)
    if archive_path is None:
        url_template = str(
            settings["ffmpeg"].get(
                "download_url_template",
                DEFAULT_URL_TEMPLATE,
            )
        )
        url = url_template.format(version=version)
        archive_path = vendor_dir / f"ffmpeg-{version}.tar.xz"
        logger.info("下载 ffmpeg %s 源码：%s", version, url)
        try:
            with urllib.request.urlopen(url, timeout=60) as response, open(  # noqa: SCS123
                archive_path,
                "wb",
            ) as output:
                shutil.copyfileobj(response, output)
        except Exception:
            archive_path.unlink(missing_ok=True)
            raise
    else:
        logger.info("使用本地 ffmpeg 源码包：%s", archive_path)

    _safe_extract(archive_path, vendor_dir)
    source = find_bundled_source(settings)
    if source is None:
        raise RuntimeError("解压完成但未找到 ffmpeg 源码目录")
    return source


def ensure_bundled_source(
    settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    settings = settings or load_settings()
    source = find_bundled_source(settings)
    if source:
        return {"ok": True, "source": str(source), "downloaded": False}
    try:
        source = download_source(settings=settings)
        return {"ok": True, "source": str(source), "downloaded": True}
    except Exception as exc:  # noqa: BLE001 - 启动流程需要兜底记录
        logger.exception("ffmpeg 源码下载失败")
        return {"ok": False, "source": None, "downloaded": False, "error": str(exc)}


def _build_command(vendor_dir: Path) -> list[str]:
    if os.name == "nt":
        powershell = shutil.which("pwsh") or shutil.which("powershell")
        if not powershell:
            raise RuntimeError("未找到 PowerShell，无法执行 Windows ffmpeg 构建脚本")
        return [
            powershell,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(vendor_dir / "build-ffmpeg.ps1"),
        ]

    bash = shutil.which("bash")
    if not bash:
        raise RuntimeError("未找到 bash，无法执行 ffmpeg 构建脚本")
    return [bash, str(vendor_dir / "build-ffmpeg.sh")]


def _tail_output(output: str, max_lines: int = 40) -> str:
    lines = output.splitlines()
    return "\n".join(lines[-max_lines:])


def build_bundled_binaries(
    settings: dict[str, Any] | None = None,
    *,
    source: Path | None = None,
) -> dict[str, Any]:
    settings = settings or load_settings()
    source = source or find_bundled_source(settings)
    if source is None:
        return {"ok": False, "built": False, "error": "未找到可用于构建的 ffmpeg 源码目录"}

    vendor_dir = get_vendor_dir(settings)
    script = vendor_dir / ("build-ffmpeg.ps1" if os.name == "nt" else "build-ffmpeg.sh")
    if not script.is_file():
        return {"ok": False, "built": False, "error": f"未找到 ffmpeg 构建脚本：{script}"}

    env = os.environ.copy()
    env.setdefault("FFMPEG_SOURCE_DIR", str(source))
    env.setdefault(
        "FFMPEG_VERSION",
        str(settings["ffmpeg"].get("source_version", DEFAULT_VERSION)),
    )

    logger.info("开始构建内置 ffmpeg：%s", source)
    try:
        result = subprocess.run(
            _build_command(vendor_dir),
            cwd=str(vendor_dir),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception as exc:  # noqa: BLE001 - 启动流程需要把错误序列化
        logger.exception("ffmpeg 构建脚本执行失败")
        return {"ok": False, "built": False, "source": str(source), "error": str(exc)}

    output = "\n".join(part for part in (result.stdout, result.stderr) if part)
    if result.returncode != 0:
        return {
            "ok": False,
            "built": False,
            "source": str(source),
            "error": f"ffmpeg 构建失败，退出码 {result.returncode}",
            "output_tail": _tail_output(output),
        }

    paths = bundled_binary_paths(settings)
    if not bundled_binaries_ready(settings):
        return {
            "ok": False,
            "built": False,
            "source": str(source),
            "error": "ffmpeg 构建脚本已完成，但未在源码目录中找到 ffmpeg 或 ffprobe",
            "output_tail": _tail_output(output),
        }

    logger.info("内置 ffmpeg 构建完成：%s", paths["ffmpeg"])
    return {
        "ok": True,
        "built": True,
        "source": str(source),
        "ffmpeg": str(paths["ffmpeg"]),
        "ffprobe": str(paths["ffprobe"]),
        "output_tail": _tail_output(output, max_lines=10),
    }


def ensure_bundled_runtime(
    settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    settings = settings or load_settings()
    if bundled_binaries_ready(settings):
        paths = bundled_binary_paths(settings)
        return {
            "ok": True,
            "downloaded": False,
            "built": False,
            "ffmpeg": str(paths["ffmpeg"]),
            "ffprobe": str(paths["ffprobe"]),
        }

    source_result = ensure_bundled_source(settings)
    if not source_result["ok"]:
        return {**source_result, "built": False}

    build_result = build_bundled_binaries(
        settings,
        source=Path(str(source_result["source"])),
    )
    return {
        **build_result,
        "downloaded": source_result.get("downloaded", False),
    }
