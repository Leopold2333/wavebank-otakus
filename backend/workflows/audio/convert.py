from __future__ import annotations

from typing import Any, Callable

from .common import build_audio_graph


def compile_convert_graph(
    *,
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
    process_holder: list[Any] | None = None,
):
    """Full LangGraph flow for audio format conversion."""
    return build_audio_graph(
        "convert",
        on_log=on_log,
        on_progress=on_progress,
        process_holder=process_holder,
    )
