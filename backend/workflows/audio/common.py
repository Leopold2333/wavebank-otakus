from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, TypedDict

from langgraph.graph import END, START, StateGraph

from ...config import load_settings, resolve_project_path
from ...tools.ffmpeg import (
    build_audio_command,
    measure_loudness,
    probe_audio,
    resolve_binaries,
    resolve_output_path,
    run_ffmpeg,
)


AUDIO_SUBTYPES = ("convert", "extract", "trim", "pitch", "denoise")


class AudioState(TypedDict, total=False):
    task_id: str
    params: dict[str, Any]
    input_path: str
    output_path: str
    target_path: str
    binaries: dict[str, str]
    probe: dict[str, Any]
    source_sample_rate: int | None
    source_true_peak: float | None
    command: list[str]
    progress: float
    outputs: list[dict[str, Any]]
    error: str


def collect_params(state: AudioState) -> dict[str, Any]:
    params = state.get("params", {})
    params.setdefault("outputFormat", "mp3")
    params.setdefault("volumeGain", 0)
    return {"params": params}


def probe_validate(state: AudioState) -> dict[str, Any]:
    settings = load_settings()
    params = state["params"]
    input_path = resolve_project_path(params.get("inputFile"))
    if input_path is None or not input_path.is_file():
        raise FileNotFoundError(f"输入文件不存在：{params.get('inputFile')}")

    binaries = resolve_binaries(settings)
    probe = probe_audio(str(input_path), binaries["ffprobe"])
    output_path = resolve_output_path(params, state["task_id"], settings)
    audio_stream = next(
        (
            stream
            for stream in probe.get("streams", [])
            if stream.get("codec_type") == "audio"
        ),
        None,
    )
    source_sample_rate = None
    if audio_stream and audio_stream.get("sample_rate"):
        try:
            source_sample_rate = int(audio_stream["sample_rate"])
        except (TypeError, ValueError):
            source_sample_rate = None

    loudness_target = params.get("loudnessTarget", params.get("loudness_target"))
    true_peak_mode = str(
        params.get("truePeakMax", params.get("true_peak_max", "source"))
    ).strip().lower()
    source_true_peak = None
    if loudness_target not in (None, "") and true_peak_mode in {"", "source", "auto"}:
        loudness = measure_loudness(str(input_path), binaries["ffmpeg"])
        source_true_peak = loudness.get("true_peak_dbtp")

    return {
        "input_path": str(input_path),
        "output_path": str(output_path),
        "target_path": str(output_path),
        "binaries": binaries,
        "probe": probe,
        "source_sample_rate": source_sample_rate,
        "source_true_peak": source_true_peak,
    }


def make_execute_node(
    subtype: str,
    *,
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
    process_holder: list[Any] | None = None,
) -> Callable[[AudioState], dict[str, Any]]:
    def _execute(state: AudioState) -> dict[str, Any]:
        command = build_audio_command(
            state["params"],
            state["input_path"],
            state["output_path"],
            state["binaries"]["ffmpeg"],
            subtype=subtype,
            source_sample_rate=state.get("source_sample_rate"),
            source_true_peak=state.get("source_true_peak"),
        )
        if on_log:
            on_log(f"[{subtype}] 执行命令：" + " ".join(command))
        total_duration_us = None
        format_info = state.get("probe", {}).get("format", {})
        try:
            total_duration_us = float(format_info.get("duration")) * 1_000_000
        except (TypeError, ValueError):
            total_duration_us = None

        run_ffmpeg(
            command,
            on_log=on_log,
            on_progress=on_progress,
            total_duration_us=total_duration_us,
            process_holder=process_holder,
            timeout=int(load_settings()["ffmpeg"].get("timeout_seconds", 3600)),
        )
        return {
            "command": command,
            "progress": 100.0,
            "target_path": state.get("target_path") or state["output_path"],
        }

    return _execute


def verify(state: AudioState) -> dict[str, Any]:
    output = Path(state["output_path"])
    if not output.exists() or output.stat().st_size == 0:
        raise RuntimeError(f"输出文件缺失或为空：{output}")
    return {"outputs": [{"path": str(output), "size": output.stat().st_size}]}


def summarize(state: AudioState) -> dict[str, Any]:
    return {
        "progress": 100.0,
        "outputs": state.get("outputs", []),
        "target_path": state.get("target_path"),
    }


def build_audio_graph(
    subtype: str,
    *,
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
    process_holder: list[Any] | None = None,
):
    """Build one complete audio subtype graph with the shared node pipeline."""
    builder = StateGraph(AudioState)
    builder.add_node("collect_params", collect_params)
    builder.add_node("probe_validate", probe_validate)
    builder.add_node(
        "execute",
        make_execute_node(
            subtype,
            on_log=on_log,
            on_progress=on_progress,
            process_holder=process_holder,
        ),
    )
    builder.add_node("verify", verify)
    builder.add_node("summarize", summarize)

    builder.add_edge(START, "collect_params")
    builder.add_edge("collect_params", "probe_validate")
    builder.add_edge("probe_validate", "execute")
    builder.add_edge("execute", "verify")
    builder.add_edge("verify", "summarize")
    builder.add_edge("summarize", END)
    return builder.compile()
