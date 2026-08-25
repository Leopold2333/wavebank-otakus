from __future__ import annotations

from typing import Any, Callable

from .common import build_audio_graph


def compile_extract_graph(
    *,
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
    process_holder: list[Any] | None = None,
):
    """Full LangGraph flow for extracting an audio track from a video file."""
    return build_audio_graph(
        "extract",
        on_log=on_log,
        on_progress=on_progress,
        process_holder=process_holder,
    )
