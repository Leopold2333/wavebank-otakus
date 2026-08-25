"""Audio subtype router graph.

Each secondary audio feature is a compiled subgraph (a full
collect_params -> probe_validate -> execute -> verify -> summarize flow).
The router graph exposes those compiled subgraphs as nodes, matching the
LangGraph pattern documented in "Subgraphs": a compiled subgraph can be added
directly with ``add_node(name, compiled_subgraph)`` when the parent and the
subgraph share state schema keys.
"""

from __future__ import annotations

from typing import Any, Callable

from langgraph.graph import END, START, StateGraph

from .common import AUDIO_SUBTYPES, AudioState
from .convert import compile_convert_graph
from .denoise import compile_denoise_graph
from .extract import compile_extract_graph
from .pitch import compile_pitch_graph
from .trim import compile_trim_graph


def _route_audio_subtype(state: AudioState) -> str:
    task_type = str(state.get("params", {}).get("task_type", "audio"))
    subtype = task_type.split(".", 1)[1] if "." in task_type else task_type
    if subtype not in AUDIO_SUBTYPES:
        subtype = "convert"
    return subtype


def compile_audio_router_graph(
    *,
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
    process_holder: list[Any] | None = None,
):
    """Build the parent audio graph with one compiled subgraph per subtype."""
    builder = StateGraph(AudioState)
    subtype_graphs = {
        "convert": compile_convert_graph(
            on_log=on_log,
            on_progress=on_progress,
            process_holder=process_holder,
        ),
        "extract": compile_extract_graph(
            on_log=on_log,
            on_progress=on_progress,
            process_holder=process_holder,
        ),
        "trim": compile_trim_graph(
            on_log=on_log,
            on_progress=on_progress,
            process_holder=process_holder,
        ),
        "pitch": compile_pitch_graph(
            on_log=on_log,
            on_progress=on_progress,
            process_holder=process_holder,
        ),
        "denoise": compile_denoise_graph(
            on_log=on_log,
            on_progress=on_progress,
            process_holder=process_holder,
        ),
    }
    for subtype, subgraph in subtype_graphs.items():
        builder.add_node(subtype, subgraph)
        builder.add_edge(subtype, END)
    builder.add_conditional_edges(
        START,
        _route_audio_subtype,
        {subtype: subtype for subtype in subtype_graphs},
    )
    return builder.compile()
