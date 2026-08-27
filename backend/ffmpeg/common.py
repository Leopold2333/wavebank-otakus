from __future__ import annotations

import json
import logging
import os
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

from ..config import PROJECT_ROOT, load_settings, save_settings


logger = logging.getLogger(__name__)

VENDOR_FFMPEG_DIR = PROJECT_ROOT / "backend" / "vendor" / "ffmpeg"
DEFAULT_PREBUILT_DIR = VENDOR_FFMPEG_DIR / "latest"
DEFAULT_DOWNLOAD_DIR = VENDOR_FFMPEG_DIR / "downloads"

# 项目界面允许输出的格式对应的必需编码器。
# 每组满足其一即可：OGG 可来自 libvorbis 或 FFmpeg 原生 Vorbis（experimental）。
REQUIRED_ENCODER_GROUPS: tuple[tuple[str, ...], ...] = (
    ("libmp3lame",),          # MP3
    ("aac",),                 # AAC / M4A
    ("flac",),                # FLAC
    ("vorbis", "libvorbis"),  # OGG
    ("pcm_s16le",),           # WAV
)


def executable_suffix() -> str:
    return ".exe" if os.name == "nt" else ""


def platform_key() -> str:
    """Return a stable platform key like linux-x86_64 / windows-x86_64."""
    system = platform.system().lower()
    machine = platform.machine().lower()
    if machine in {"amd64", "x86_64"}:
        arch = "x86_64"
    elif machine in {"aarch64", "arm64"}:
        arch = "arm64"
    elif machine in {"i386", "i686", "x86"}:
        arch = "x86"
    elif machine.startswith("armv7"):
        arch = "armv7"
    else:
        arch = machine
    return f"{system}-{arch}"


def get_prebuilt_dir(settings: dict[str, Any] | None = None) -> Path:
    """Return the directory that holds the currently installed prebuilt ffmpeg."""
    settings = settings or load_settings()
    suffix = executable_suffix()
    installed = str(
        settings.get("ffmpeg", {}).get("prebuilt_installed_path") or ""
    ).strip()
    if installed:
        candidate = Path(installed)
        if candidate.is_file() and candidate.name in {
            f"ffmpeg{suffix}",
            f"ffprobe{suffix}",
        }:
            return candidate.parent

    # 没有配置记录时，扫描 vendor 下已安装的版本目录（latest/ 或 9.0.1/ 等）。
    candidates = [
        path
        for path in VENDOR_FFMPEG_DIR.glob("*")
        if path.is_dir()
        and (path / f"ffmpeg{suffix}").is_file()
        and (path / f"ffprobe{suffix}").is_file()
    ]
    candidates.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else DEFAULT_PREBUILT_DIR


def prebuilt_binary_paths(settings: dict[str, Any] | None = None) -> dict[str, Path]:
    settings = settings or load_settings()
    suffix = executable_suffix()
    prebuilt_dir = get_prebuilt_dir(settings)
    return {
        "ffmpeg": prebuilt_dir / f"ffmpeg{suffix}",
        "ffprobe": prebuilt_dir / f"ffprobe{suffix}",
    }


def prebuilt_binaries_ready(settings: dict[str, Any] | None = None) -> bool:
    paths = prebuilt_binary_paths(settings)
    return paths["ffmpeg"].is_file() and paths["ffprobe"].is_file()


def read_ffmpeg_encoders(ffmpeg_path: str) -> set[str]:
    """Return the encoder names reported by ``ffmpeg -encoders``."""
    result = subprocess.run(
        [ffmpeg_path, "-hide_banner", "-encoders"],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg -encoders 执行失败：{result.stderr.strip() or '未知错误'}"
        )
    encoders: set[str] = set()
    for line in result.stdout.splitlines():
        parts = line.split()
        # 第一列是类型标志（如 V...../A.....），第二列是编码器名；
        # 开头的图例行（如 "V..... = Video"）需要跳过。
        if (
            len(parts) >= 2
            and parts[0].startswith(("V", "A", "S"))
            and parts[1] != "="
        ):
            encoders.add(parts[1])
    return encoders


def missing_required_encoders(encoders: set[str]) -> list[str]:
    """Return the first missing encoder name of each required group."""
    missing: list[str] = []
    for group in REQUIRED_ENCODER_GROUPS:
        if not any(name in encoders for name in group):
            missing.append(group[0])
    return missing


def verify_prebuilt_binaries(
    settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Verify that prebuilt binaries exist, run, and cover required encoders."""
    settings = settings or load_settings()
    paths = prebuilt_binary_paths(settings)
    return _verify_ffmpeg_binaries(
        paths["ffmpeg"],
        paths["ffprobe"],
        missing_message="内置 ffmpeg 预编译包未安装",
        error_prefix="内置 ffmpeg 不可用",
    )


def _download_file(url: str, dest: Path) -> None:
    logger.info("下载预编译 ffmpeg：%s", url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(url, timeout=120) as response, open(  # noqa: SCS123
            dest,
            "wb",
        ) as output:
            shutil.copyfileobj(response, output)
    except Exception:
        dest.unlink(missing_ok=True)
        raise


def _fetch_json(url: str, timeout: int = 30) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": "wavebank-otakus"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _run_command(
    args: list[str],
    *,
    capture_output: bool = True,
    env: dict[str, str] | None = None,
    timeout: int | None = None,
) -> subprocess.CompletedProcess[str]:
    logger.info("执行命令：%s", " ".join(args))
    result = subprocess.run(
        args,
        capture_output=capture_output,
        text=capture_output,
        timeout=timeout,
        check=False,
        env=env,
    )
    if result.returncode != 0:
        if capture_output:
            output = (result.stderr or result.stdout or "未知错误").strip()
            message = "\n".join(output.splitlines()[-20:])
        else:
            message = f"退出码 {result.returncode}"
        raise RuntimeError(f"{' '.join(args)} 执行失败：{message}")
    return result


def _verify_ffmpeg_binaries(
    ffmpeg_path: Path,
    ffprobe_path: Path,
    *,
    missing_message: str,
    error_prefix: str,
) -> dict[str, Any]:
    if not ffmpeg_path.is_file() or not ffprobe_path.is_file():
        return {"ok": False, "error": missing_message}
    try:
        result = subprocess.run(
            [str(ffmpeg_path), "-version"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "无法执行 ffmpeg")
        version = result.stdout.splitlines()[0] if result.stdout else "ffmpeg"
        encoders = read_ffmpeg_encoders(str(ffmpeg_path))
    except Exception as exc:  # noqa: BLE001 - 启动流程需要把错误序列化
        return {"ok": False, "error": f"{error_prefix}：{exc}"}

    missing = missing_required_encoders(encoders)
    payload: dict[str, Any] = {
        "ok": not missing,
        "version": version,
        "encoders": sorted(encoders),
        "missing_encoders": missing,
    }
    if missing:
        payload["error"] = "ffmpeg 缺少必需编码器：" + "、".join(missing)
    return payload


def _resolve_release_url(
    settings: dict[str, Any],
    key: str,
    url: str,
) -> str:
    """Fill {version} placeholders from the platform's release list."""
    if "{version}" not in url:
        return url
    release_lists = settings.get("ffmpeg", {}).get("prebuilt_release_lists", {})
    list_url = str(release_lists.get(key) or "").strip()
    if not list_url:
        raise RuntimeError(
            f"{key} 的下载地址包含 {{version}}，但未配置 release 列表地址"
        )

    payload = _fetch_json(list_url)
    if isinstance(payload, list):
        payload = next(
            (
                item
                for item in payload
                if not item.get("draft") and not item.get("prerelease")
            ),
            payload[0] if payload else None,
        )
    if not isinstance(payload, dict):
        raise RuntimeError(f"release 列表格式异常：{list_url}")

    version = str(payload.get("tag_name") or payload.get("name") or "").strip()
    if not version:
        raise RuntimeError(f"release 列表中未找到版本号：{list_url}")

    resolved = url.replace("{version}", version)
    expected_name = resolved.rsplit("/", 1)[-1].split("?")[0]
    assets = payload.get("assets") or []
    if assets and not any(
        str(asset.get("name") or "") == expected_name for asset in assets
    ):
        available = "、".join(str(asset.get("name")) for asset in assets[:10])
        raise RuntimeError(
            f"release {version} 中未找到 {expected_name}。可用资产：{available}"
        )
    logger.info("已从 release 列表解析版本：%s -> %s", version, resolved)
    return resolved


def _detect_version(url: str) -> str | None:
    """Extract an explicit version from the download URL, e.g. 9.0.1."""
    match = re.search(r"(\d+\.\d+(?:\.\d+)?)", url.split("?", 1)[0])
    return match.group(1) if match else None


def _safe_extract_tar(archive: Path, dest: Path) -> None:
    with tarfile.open(archive) as archive_file:
        for member in archive_file.getmembers():
            resolved = (dest / member.name).resolve()
            if not resolved.is_relative_to(dest.resolve()):
                raise ValueError(f"压缩包包含非法路径：{member.name}")
        archive_file.extractall(dest)


def _safe_extract_zip(archive: Path, dest: Path) -> None:
    with zipfile.ZipFile(archive) as archive_file:
        for info in archive_file.infolist():
            resolved = (dest / info.filename).resolve()
            if not resolved.is_relative_to(dest.resolve()):
                raise ValueError(f"压缩包包含非法路径：{info.filename}")
        archive_file.extractall(dest)


def _extract_archive(archive: Path, dest: Path) -> None:
    if zipfile.is_zipfile(archive):
        _safe_extract_zip(archive, dest)
    elif tarfile.is_tarfile(archive):
        _safe_extract_tar(archive, dest)
    else:
        raise RuntimeError(f"不支持的压缩包格式：{archive}")


def _install_prebuilt_binaries(extract_dir: Path, prebuilt_dir: Path) -> bool:
    suffix = executable_suffix()
    for ffmpeg_path in sorted(extract_dir.rglob(f"ffmpeg{suffix}")):
        if not ffmpeg_path.is_file():
            continue
        ffprobe_path = ffmpeg_path.parent / f"ffprobe{suffix}"
        if not ffprobe_path.is_file():
            continue
        prebuilt_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ffmpeg_path, prebuilt_dir / f"ffmpeg{suffix}")
        shutil.copy2(ffprobe_path, prebuilt_dir / f"ffprobe{suffix}")
        if os.name != "nt":
            (prebuilt_dir / f"ffmpeg{suffix}").chmod(0o755)
            (prebuilt_dir / f"ffprobe{suffix}").chmod(0o755)
        return True
    return False


def _persist_prebuilt_path(ffmpeg_path: Path) -> None:
    try:
        save_settings({"ffmpeg": {"prebuilt_installed_path": str(ffmpeg_path)}})
    except Exception:  # noqa: BLE001 - 写配置失败不应让安装流程失败
        logger.exception("写入 prebuilt_installed_path 配置失败")


def _persist_system_path(ffmpeg_path: Path) -> None:
    try:
        save_settings({"ffmpeg": {"executable_path": str(ffmpeg_path)}})
    except Exception:  # noqa: BLE001 - 写配置失败不应让安装流程失败
        logger.exception("写入 executable_path 配置失败")


def _install_configured_prebuilt(
    settings: dict[str, Any],
    key: str,
    *,
    force: bool = False,
    missing_hint: str,
) -> dict[str, Any]:
    """Download and install the configured prebuilt ffmpeg archive."""
    urls = settings.get("ffmpeg", {}).get("prebuilt_urls", {})
    url = str(urls.get(key) or "").strip()
    if not url:
        return {
            "ok": False,
            "downloaded": False,
            "error": (
                f"当前平台 {key} 没有配置预编译 ffmpeg 下载地址。"
                f"{missing_hint}"
            ),
        }

    try:
        url = _resolve_release_url(settings, key, url)
    except Exception as exc:  # noqa: BLE001 - 启动流程需要把错误序列化
        logger.exception("解析预编译 ffmpeg 下载地址失败")
        return {
            "ok": False,
            "downloaded": False,
            "error": f"解析预编译 ffmpeg 下载地址失败：{exc}",
        }

    version_name = _detect_version(url) or "latest"
    prebuilt_dir = VENDOR_FFMPEG_DIR / version_name
    if not force and prebuilt_binaries_ready(settings):
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

    download_dir = DEFAULT_DOWNLOAD_DIR
    filename = url.split("?")[0].rsplit("/", 1)[-1] or "ffmpeg-archive"
    archive = download_dir / filename
    try:
        _download_file(url, archive)
    except Exception as exc:  # noqa: BLE001 - 启动流程需要把错误序列化
        logger.exception("预编译 ffmpeg 下载失败")
        return {
            "ok": False,
            "downloaded": False,
            "error": f"下载预编译 ffmpeg 失败：{exc}",
        }

    DEFAULT_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    extract_dir = Path(
        tempfile.mkdtemp(prefix="extract-", dir=str(DEFAULT_PREBUILT_DIR.parent))
    )
    try:
        _extract_archive(archive, extract_dir)
        if not _install_prebuilt_binaries(extract_dir, prebuilt_dir):
            return {
                "ok": False,
                "downloaded": True,
                "error": "预编译包中未找到 ffmpeg/ffprobe，请检查下载源配置",
            }
    except Exception as exc:  # noqa: BLE001 - 启动流程需要把错误序列化
        logger.exception("预编译 ffmpeg 解压失败")
        return {"ok": False, "downloaded": True, "error": f"解压预编译 ffmpeg 失败：{exc}"}
    finally:
        shutil.rmtree(extract_dir, ignore_errors=True)

    verified = verify_prebuilt_binaries(settings)
    if not verified["ok"]:
        return {
            "ok": False,
            "downloaded": True,
            "error": verified.get("error", "预编译 ffmpeg 校验失败"),
            "encoders": verified.get("encoders", []),
            "missing_encoders": verified.get("missing_encoders", []),
        }

    paths = prebuilt_binary_paths(settings)
    logger.info("预编译 ffmpeg 安装完成：%s", paths["ffmpeg"])
    _persist_prebuilt_path(paths["ffmpeg"])
    return {
        "ok": True,
        "downloaded": True,
        "ffmpeg": str(paths["ffmpeg"]),
        "ffprobe": str(paths["ffprobe"]),
        **verified,
    }
