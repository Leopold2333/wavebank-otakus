from __future__ import annotations

import logging
import shutil
import tarfile
import urllib.request
from pathlib import Path
from typing import Any

from ..config import PROJECT_ROOT, load_settings, resolve_project_path


logger = logging.getLogger(__name__)

DEFAULT_VENDOR_DIR = PROJECT_ROOT / "backend" / "vendor" / "ffmpeg"
DEFAULT_VERSION = "9.0.1"
DEFAULT_URL_TEMPLATE = "https://ffmpeg.org/releases/ffmpeg-{version}.tar.xz"


def get_vendor_dir(settings: dict[str, Any] | None = None) -> Path:
    """Return the directory that contains ffmpeg source archives/extracted dirs."""
    settings = settings or load_settings()
    configured = resolve_project_path(settings["ffmpeg"].get("bundled_dir"))
    if configured and configured.name == "bin":
        return configured.parent
    return DEFAULT_VENDOR_DIR


def find_bundled_source(settings: dict[str, Any] | None = None) -> Path | None:
    """Find any extracted ffmpeg source directory, keeping its original name."""
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
    *,
    auto_download: bool = True,
) -> dict[str, Any]:
    settings = settings or load_settings()
    source = find_bundled_source(settings)
    if source:
        return {"ok": True, "source": str(source), "downloaded": False}
    if not auto_download:
        return {
            "ok": False,
            "source": None,
            "downloaded": False,
            "error": "未找到内置 ffmpeg 源码，且自动下载已关闭",
        }
    try:
        source = download_source(settings=settings)
        return {"ok": True, "source": str(source), "downloaded": True}
    except Exception as exc:  # noqa: BLE001 - 启动流程需要兜底记录
        logger.exception("ffmpeg 源码下载失败")
        return {"ok": False, "source": None, "downloaded": False, "error": str(exc)}
