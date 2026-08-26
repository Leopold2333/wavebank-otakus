from __future__ import annotations

import json
import math
import os
import platform
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

from ..config import PROJECT_ROOT, load_settings, resolve_project_path
from ..ffmpeg.setup import (
    missing_required_encoders,
    prebuilt_binary_paths,
    read_ffmpeg_encoders,
)


class FfmpegNotFound(RuntimeError):
    pass


class FfmpegError(RuntimeError):
    pass


def executable_suffix() -> str:
    return ".exe" if os.name == "nt" else ""


def _find_system_ffmpeg() -> Path | None:
    """Find ffmpeg on PATH; on macOS also probe Homebrew locations."""
    candidates: list[Path] = []
    found = shutil.which("ffmpeg")
    if found:
        candidates.append(Path(found).resolve())
    if platform.system() == "Darwin":
        candidates.extend(
            [
                Path("/opt/homebrew/bin/ffmpeg"),
                Path("/usr/local/bin/ffmpeg"),
            ]
        )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def resolve_binaries(settings: dict[str, Any] | None = None) -> dict[str, str]:
    """Resolve ffmpeg/ffprobe executables according to the current settings."""
    settings = settings or load_settings()
    ffmpeg_cfg = settings.get("ffmpeg", {})
    paths = prebuilt_binary_paths(settings)

    configured_path = str(ffmpeg_cfg.get("executable_path") or "").strip()
    if configured_path:
        ffmpeg_path = Path(configured_path).expanduser()
        if not ffmpeg_path.is_absolute():
            raise FfmpegNotFound(f"自定义 ffmpeg 路径必须是绝对路径：{configured_path}")
        if not ffmpeg_path.is_file():
            raise FfmpegNotFound(f"自定义 ffmpeg 不存在：{ffmpeg_path}")
        ffprobe_path = ffmpeg_path.with_name(f"ffprobe{executable_suffix()}")
        if not ffprobe_path.is_file():
            raise FfmpegNotFound(
                f"自定义 ffmpeg 同目录未找到 ffprobe：{ffprobe_path}"
            )
        return {
            "ffmpeg": str(ffmpeg_path),
            "ffprobe": str(ffprobe_path),
            "source": "configured",
        }

    system_ffmpeg = _find_system_ffmpeg()
    if system_ffmpeg:
        ffmpeg_path = system_ffmpeg
        ffprobe_path = ffmpeg_path.with_name(f"ffprobe{executable_suffix()}")
        if ffprobe_path.is_file():
            return {
                "ffmpeg": str(ffmpeg_path),
                "ffprobe": str(ffprobe_path),
                "source": "system",
            }
        raise FfmpegNotFound(
            f"PATH 中找到 ffmpeg（{ffmpeg_path}），但同目录未找到 ffprobe。"
        )

    if paths["ffmpeg"].is_file() and paths["ffprobe"].is_file():
        return {
            "ffmpeg": str(paths["ffmpeg"]),
            "ffprobe": str(paths["ffprobe"]),
            "source": "bundled",
        }

    raise FfmpegNotFound(
        "未找到可用 ffmpeg：没有配置自定义路径，内置预编译包未安装，"
        "PATH 中也没有 ffmpeg。启动时会按平台自动下载预编译包，"
        "或在设置页填写自定义 ffmpeg 路径。"
    )


def ffmpeg_version(ffmpeg_path: str) -> str:
    result = subprocess.run(
        [ffmpeg_path, "-version"],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if result.returncode != 0:
        raise FfmpegError(result.stderr.strip() or "无法获取 ffmpeg 版本")
    return result.stdout.splitlines()[0] if result.stdout else "ffmpeg"


def get_ffmpeg_info(settings: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = settings or load_settings()
    bundled_paths = prebuilt_binary_paths(settings)
    bundled_info = {
        "bundled_ffmpeg": str(bundled_paths["ffmpeg"]),
        "bundled_ffprobe": str(bundled_paths["ffprobe"]),
    }
    try:
        resolved = resolve_binaries(settings)
        version = ffmpeg_version(resolved["ffmpeg"])
        encoders = read_ffmpeg_encoders(resolved["ffmpeg"])
        missing = missing_required_encoders(encoders)
        info = {
            "ok": not missing,
            "version": version,
            "encoders": sorted(encoders),
            "missing_encoders": missing,
            **bundled_info,
            **resolved,
        }
        if missing:
            info["error"] = "ffmpeg 缺少必需编码器：" + "、".join(missing)
        return info
    except Exception as exc:  # noqa: BLE001 - API 层需要把错误序列化给前端
        return {"ok": False, "error": str(exc), **bundled_info}


def probe_audio(audio_path: str, ffprobe_path: str) -> dict[str, Any]:
    if not ffprobe_path:
        raise FfmpegNotFound("未找到 ffprobe，无法探测音频信息")
    result = subprocess.run(
        [
            ffprobe_path,
            "-v",
            "error",
            "-show_entries",
            "format=duration,bit_rate,format_name",
            "-show_entries",
            "stream=index,codec_name,codec_type,sample_rate,channels,channel_layout,bit_rate,disposition",
            "-of",
            "json",
            str(audio_path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise FfmpegError(f"ffprobe 失败：{result.stderr.strip() or '未知错误'}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise FfmpegError(f"ffprobe 输出解析失败：{exc}") from exc


def _analyze_audio(audio_path: str, ffmpeg_path: str, timeout: int = 120) -> dict[str, Any]:
    """Analyze peak/RMS/dynamic range with ffmpeg astats (best effort)."""
    result = subprocess.run(
        [
            ffmpeg_path,
            "-hide_banner",
            "-nostdin",
            "-i",
            audio_path,
            "-map",
            "0:a:0?",
            "-vn",
            "-af",
            "astats=metadata=0",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        return {}

    def _last_float(pattern: str) -> float | None:
        matches = re.findall(pattern, result.stderr)
        if not matches:
            return None
        try:
            return float(matches[-1])
        except ValueError:
            return None

    return {
        "peak_dB": _last_float(r"Peak level dB:\s*([-\d.]+)"),
        "rms_dB": _last_float(r"RMS level dB:\s*([-\d.]+)"),
        "dynamic_range_dB": _last_float(r"Dynamic range:\s*([-\d.]+)"),
    }


def _analyze_loudness(audio_path: str, ffmpeg_path: str, timeout: int = 120) -> dict[str, Any]:
    """Analyze EBU R128 loudness from the final ffmpeg ebur128 summary."""
    result = subprocess.run(
        [
            ffmpeg_path,
            "-hide_banner",
            "-nostdin",
            "-i",
            audio_path,
            "-map",
            "0:a:0?",
            "-vn",
            "-af",
            "ebur128=peak=true",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        return {}

    summary = (
        result.stderr.rsplit("Summary:", 1)[-1]
        if "Summary:" in result.stderr
        else result.stderr
    )

    def _find_float(pattern: str) -> float | None:
        matches = re.findall(pattern, summary)
        if not matches:
            return None
        try:
            return float(matches[-1])
        except ValueError:
            return None

    return {
        "integrated_loudness_lufs": _find_float(r"I:\s+([-\d.]+) LUFS"),
        "loudness_range_lu": _find_float(r"LRA:\s+([-\d.]+) LU"),
        "true_peak_dbtp": _find_float(r"Peak:\s+([-\d.]+) dBFS"),
    }


def measure_loudness(audio_path: str, ffmpeg_path: str, timeout: int = 120) -> dict[str, Any]:
    """Measure EBU R128 loudness / true peak for a source file."""
    return _analyze_loudness(audio_path, ffmpeg_path, timeout=timeout)


def probe_audio_details(
    audio_path: str,
    settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return detailed audio info for the frontend player panel."""
    settings = settings or load_settings()
    binaries = resolve_binaries(settings)
    probe = probe_audio(audio_path, binaries["ffprobe"])

    path = Path(audio_path).resolve()
    path_stat = path.stat()

    format_info = probe.get("format", {})
    raw_streams = probe.get("streams", [])
    has_video = any(
        stream.get("codec_type") == "video"
        and not (stream.get("disposition") or {}).get("attached_pic", 0)
        for stream in raw_streams
    )
    # 视频文件只做轻量探测（时长/流信息），不执行全量解码与响度分析。
    analysis: dict[str, Any] = {}
    if not has_video:
        analysis = _analyze_audio(audio_path, binaries["ffmpeg"])
        analysis.update(_analyze_loudness(audio_path, binaries["ffmpeg"]))

    streams = [
        {
            "index": stream.get("index"),
            "codec_name": stream.get("codec_name"),
            "codec_type": stream.get("codec_type"),
            "sample_rate": stream.get("sample_rate"),
            "channels": stream.get("channels"),
            "channel_layout": stream.get("channel_layout"),
            "bit_rate": stream.get("bit_rate"),
            "disposition": stream.get("disposition"),
        }
        for stream in raw_streams
    ]
    try:
        duration = float(format_info.get("duration", 0) or 0)
    except (TypeError, ValueError):
        duration = 0.0
    try:
        bit_rate = int(format_info.get("bit_rate", 0) or 0)
    except (TypeError, ValueError):
        bit_rate = 0

    return {
        "path": str(path),
        "name": path.name,
        "size": path_stat.st_size,
        "container": format_info.get("format_name"),
        "duration": duration,
        "bit_rate": bit_rate,
        "streams": streams,
        "has_video": has_video,
        "analysis": analysis,
    }


def _parse_progress_fields(fields: dict[str, str], total_duration_us: float | None) -> dict[str, Any]:
    if fields.get("progress") == "end":
        return {"percent": 100.0, "progress": "end"}

    out_time_us = 0
    raw_out_us = fields.get("out_time_us")
    raw_out_ms = fields.get("out_time_ms")
    if raw_out_us:
        out_time_us = int(float(raw_out_us))
    elif raw_out_ms:
        out_time_us = int(float(raw_out_ms) * 1000)
    elif "out_time" in fields:
        # ffmpeg 9 仍会输出 out_time=HH:MM:SS.microseconds
        try:
            parts = fields["out_time"].split(":")
            out_time_us = int(
                (int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])) * 1_000_000
            )
        except (ValueError, IndexError):
            out_time_us = 0

    percent = None
    if total_duration_us and total_duration_us > 0:
        percent = min(99.9, out_time_us / total_duration_us * 100)
    return {
        "percent": percent,
        "out_time_us": out_time_us,
        "speed": fields.get("speed"),
    }


def run_ffmpeg(
    command: list[str],
    *,
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
    timeout: int | None = None,
    total_duration_us: float | None = None,
    process_holder: list[subprocess.Popen[str]] | None = None,
) -> None:
    """Run ffmpeg with progress parsing; never uses shell string concatenation."""
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    if process_holder is not None:
        process_holder.append(process)

    stderr_lines: list[str] = []

    def drain_stdout() -> None:
        assert process.stdout is not None
        progress_fields: dict[str, str] = {}
        for line in process.stdout:
            clean = line.strip()
            if "=" in clean:
                key, value = clean.split("=", 1)
                progress_fields[key] = value
            if progress_fields.get("progress"):
                parsed = _parse_progress_fields(progress_fields, total_duration_us)
                if parsed and parsed.get("percent") is not None and on_progress:
                    on_progress(float(parsed["percent"]))
                progress_fields = {}

    def drain_stderr() -> None:
        assert process.stderr is not None
        for line in process.stderr:
            clean = line.rstrip()
            if clean:
                stderr_lines.append(clean)
                if on_log:
                    on_log(clean)

    stdout_thread = threading.Thread(target=drain_stdout, daemon=True)
    stderr_thread = threading.Thread(target=drain_stderr, daemon=True)
    stdout_thread.start()
    stderr_thread.start()

    try:
        returncode = process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        raise FfmpegError(
            f"ffmpeg 执行超时（{timeout}s）\n" + "\n".join(stderr_lines[-20:])
        ) from None
    finally:
        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)

    if returncode != 0:
        tail = "\n".join(stderr_lines[-30:])
        raise FfmpegError(f"ffmpeg 退出码 {returncode}\n{tail}")
    if on_progress:
        on_progress(100.0)


def _first_value(params: dict[str, Any], *names: str, default: Any = None) -> Any:
    """Read the first non-empty parameter; accepts both camelCase and snake_case."""
    for name in names:
        if name in params and params[name] not in (None, ""):
            return params[name]
    return default


def _number(value: Any, label: str, *, minimum: float | None = None, maximum: float | None = None) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise FfmpegError(f"{label} 必须是数字：{value!r}") from exc
    if minimum is not None and number < minimum:
        raise FfmpegError(f"{label} 不能小于 {minimum}")
    if maximum is not None and number > maximum:
        raise FfmpegError(f"{label} 不能大于 {maximum}")
    return number


def _integer(value: Any, label: str, *, minimum: int | None = None) -> int:
    number = int(_number(value, label))
    if minimum is not None and number < minimum:
        raise FfmpegError(f"{label} 不能小于 {minimum}")
    return number


def build_audio_command(
    params: dict[str, Any],
    input_path: str,
    output_path: str,
    ffmpeg_path: str,
    *,
    subtype: str | None = None,
    source_sample_rate: int | str | None = None,
    source_true_peak: float | None = None,
) -> list[str]:
    """Build a safe argument-list ffmpeg command for an audio subtype task."""
    task_type = str(params.get("task_type", "audio"))
    subtype = subtype or (
        task_type.split(".", 1)[1] if "." in task_type else task_type
    )
    if subtype not in {"convert", "extract", "trim", "pitch", "denoise"}:
        subtype = "convert"

    command = [ffmpeg_path, "-hide_banner", "-nostdin", "-y"]

    start_time = _first_value(params, "startTime", "start_time")
    if subtype == "trim" and start_time not in (None, 0):
        start_seconds = _number(start_time, "开始时间", minimum=0)
        command += ["-ss", f"{start_seconds:g}"]
    command += ["-i", input_path]

    if subtype == "extract":
        audio_track = _first_value(params, "audioTrack", "audio_track", default=0)
        track_index = _integer(audio_track, "音轨序号", minimum=0)
        command += ["-map", f"0:a:{track_index}"]

    filters: list[str] = []

    if subtype == "pitch":
        pitch = _first_value(params, "pitchSemitones", "pitch_semitones", default=None)
        speed = _first_value(params, "speed", default=1)
        pitch_explicit = pitch not in (None, "")
        if pitch_explicit:
            pitch_semitones = _integer(pitch, "变调", minimum=-12)
            if pitch_semitones < -12 or pitch_semitones > 12:
                raise FfmpegError("变调范围必须是 -12 到 12 个半音")
        speed_factor = _number(speed, "变速", minimum=0.5, maximum=100)

        sample_rate = source_sample_rate or _first_value(
            params, "sampleRate", "sample_rate", default=44100
        )
        source_rate = _number(sample_rate, "采样率", minimum=1)

        if not pitch_explicit:
            # 默认自然变速：速度变化时音调随速度一起变化，不做保持音调补偿。
            if speed_factor != 1:
                filters.append(f"asetrate={source_rate:g}*{speed_factor:.6f}")
                filters.append(f"aresample={source_rate:g}")
        else:
            ratio = 2 ** (pitch_semitones / 12)
            natural_semitones = 12 * math.log2(speed_factor)
            if abs(pitch_semitones - natural_semitones) < 0.05:
                # 用户设置的变调与自然变速产生的变调一致，直接自然变速。
                if speed_factor != 1:
                    filters.append(f"asetrate={source_rate:g}*{speed_factor:.6f}")
                    filters.append(f"aresample={source_rate:g}")
            else:
                # 变调与自然变调不一致：按目标音调变速后补偿时长，再应用目标速度。
                if ratio != 1:
                    filters.append(f"asetrate={source_rate:g}*{ratio:.6f}")
                    filters.append(f"aresample={source_rate:g}")
                    filters.append(f"atempo={1 / ratio:.6f}")
                if speed_factor != 1:
                    filters.append(f"atempo={speed_factor:.4f}")

    if subtype == "denoise":
        strength = _first_value(params, "denoiseStrength", "denoise_strength", default=25)
        strength_db = _number(strength, "降噪强度", minimum=0, maximum=60)
        if strength_db > 0:
            filters.append(f"afftdn=nr={strength_db:g}:nf=-70")

    gain = _first_value(params, "volumeGain", "volume_gain", default=0)
    if gain not in (None, 0):
        gain_db = _number(gain, "音量增益", minimum=-30, maximum=30)
        filters.append(f"volume={gain_db:g}dB")

    loudness_target = _first_value(params, "loudnessTarget", "loudness_target")
    if loudness_target not in (None, ""):
        true_peak = _first_value(params, "truePeakMax", "true_peak_max", default="source")
        if str(true_peak).strip().lower() in {"", "source", "auto"}:
            true_peak_db = source_true_peak if source_true_peak is not None else -1.5
        else:
            true_peak_db = _number(true_peak, "真峰值上限", minimum=-9, maximum=0)
        true_peak_db = max(-9.0, min(0.0, true_peak_db))
        filters.append(f"loudnorm=I={loudness_target}:TP={true_peak_db:g}:LRA=11")

    if filters:
        command += ["-af", ",".join(filters)]

    if subtype == "trim":
        duration = _first_value(params, "duration", "duration_seconds")
        if duration not in (None, ""):
            duration_seconds = _number(duration, "时长", minimum=0.1)
            command += ["-t", f"{duration_seconds:g}"]
        else:
            end_time = _first_value(params, "endTime", "end_time")
            if end_time not in (None, ""):
                end_seconds = _number(end_time, "结束时间", minimum=0)
                command += ["-to", f"{end_seconds:g}"]

    sample_rate = _first_value(params, "sampleRate", "sample_rate")
    if sample_rate not in (None, ""):
        command += ["-ar", str(sample_rate)]

    channels = _first_value(params, "channels", "channel")
    if channels not in (None, "", 0):
        command += ["-ac", str(channels)]

    bitrate = _first_value(params, "bitrate", "bit_rate")
    if bitrate not in (None, ""):
        command += ["-b:a", str(bitrate)]

    # 当前阶段只处理音频；即使输入是视频，也只保留音轨。
    command += ["-vn"]
    # 未链接 libvorbis 时，原生 Vorbis 编码器标记为 experimental，需要显式放行。
    if Path(output_path).suffix.lower() in {".ogg", ".oga"}:
        command += ["-strict", "experimental"]
    command.append(output_path)
    return command


def resolve_output_path(params: dict[str, Any], task_id: str, settings: dict[str, Any]) -> Path:
    """Return the output file inside the task's own UUID directory."""
    task_root = resolve_project_path(settings["paths"].get("tmp_dir", "tmp"))
    if task_root is None:
        task_root = PROJECT_ROOT / "tmp"
    task_dir = task_root / task_id
    task_dir.mkdir(parents=True, exist_ok=True)

    input_path = Path(params["inputFile"])
    output_format = str(
        _first_value(params, "outputFormat", "output_format", default="mp3")
    ).lstrip(".")
    if output_format == "aac":
        output_format = "m4a"
    output_file_name = _first_value(params, "outputFileName", "output_file_name", default="")
    if output_file_name not in (None, ""):
        safe_name = Path(str(output_file_name)).name.strip()
        if safe_name in {"", ".", ".."}:
            raise FfmpegError("输出文件名不能为空，也不能包含路径")
        stem = Path(safe_name).stem or safe_name
    else:
        stem = input_path.stem or "output"
    return task_dir / f"{stem}.{output_format}"
