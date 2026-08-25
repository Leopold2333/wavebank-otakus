from __future__ import annotations

from typing import Any, Callable

from .common import build_audio_graph


def compile_pitch_graph(
    *,
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
    process_holder: list[Any] | None = None,
):
    """Full LangGraph flow for speed/pitch adjustment."""
    return build_audio_graph(
        "pitch",
        on_log=on_log,
        on_progress=on_progress,
        process_holder=process_holder,
    )
