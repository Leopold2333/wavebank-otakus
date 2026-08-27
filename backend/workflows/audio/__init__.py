"""Audio subtype LangGraphs.

Each secondary audio feature owns a dedicated graph so that later tuning of one
feature's flow (probe rules, confirmation points, retry policy, verify logic)
does not affect the others.
"""

from __future__ import annotations

from typing import Any, Callable

from .common import AUDIO_SUBTYPES, AudioState
from .convert import compile_convert_graph
from .denoise import compile_denoise_graph
from .extract import compile_extract_graph
from .pitch import compile_pitch_graph
from .pipeline import (
    PIPELINE_TASK_TYPE,
    AudioPipelineState,
    compile_audio_pipeline_graph,
    normalize_pipeline_steps,
)
from .router import compile_audio_router_graph
from .trim import compile_trim_graph
from .vocal_separation import compile_vocal_separation_graph


AUDIO_GRAPH_COMPILERS: dict[str, Callable[..., Any]] = {
    "convert": compile_convert_graph,
    "extract": compile_extract_graph,
    "trim": compile_trim_graph,
    "pitch": compile_pitch_graph,
    "denoise": compile_denoise_graph,
    "vocal_separation": compile_vocal_separation_graph,
}

if set(AUDIO_GRAPH_COMPILERS) != set(AUDIO_SUBTYPES):
    raise RuntimeError("音频子图注册表与 AUDIO_SUBTYPES 不一致，请同步")


def get_audio_graph_compiler(task_type: str) -> Callable[..., Any]:
    """Return the dedicated graph compiler for an audio task type."""
    subtype = task_type.split(".", 1)[1] if "." in task_type else task_type
    if subtype == "audio":
        subtype = "convert"
    try:
        return AUDIO_GRAPH_COMPILERS[subtype]
    except KeyError as exc:
        raise ValueError(f"未知音频二级任务类型：{task_type}") from exc


def compile_audio_graph(task_type: str = "audio.convert", **kwargs: Any) -> Any:
    """Backward-compatible dispatcher: delegates to the subtype graph."""
    return get_audio_graph_compiler(task_type)(**kwargs)


__all__ = [
    "AUDIO_GRAPH_COMPILERS",
    "PIPELINE_TASK_TYPE",
    "AudioPipelineState",
    "AudioState",
    "compile_audio_graph",
    "compile_audio_pipeline_graph",
    "compile_audio_router_graph",
    "get_audio_graph_compiler",
    "normalize_pipeline_steps",
]
