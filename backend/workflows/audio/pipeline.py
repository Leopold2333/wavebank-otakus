from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, TypedDict

from langgraph.graph import END, START, StateGraph

from .common import AUDIO_SUBTYPES
from .router import compile_audio_router_graph


PIPELINE_TASK_TYPE = "audio.pipeline"
PIPELINE_FINAL_PARAM_KEYS = {
    "outputFormat",
    "outputFileName",
    "bitrate",
    "sampleRate",
    "channels",
    "truePeakMax",
    "volumeGain",
    "loudnessTarget",
}
PIPELINE_STEP_LIMIT = 8


class AudioPipelineState(TypedDict, total=False):
    task_id: str
    params: dict[str, Any]
    steps: list[dict[str, Any]]
    step_offset: int
    current_input: str
    current_step: dict[str, Any]
    current_step_params: dict[str, Any]
    last_step_state: dict[str, Any]
    commands: list[list[str]]
    command: list[str] | None
    outputs: list[dict[str, Any]]
    target_path: str


def _audio_task_type_to_subtype(task_type: str) -> str:
    subtype = task_type.split(".", 1)[1] if "." in task_type else task_type
    if subtype == "audio":
        subtype = "convert"
    if subtype not in AUDIO_SUBTYPES:
        raise ValueError(f"未知音频编排步骤类型：{task_type}")
    return subtype


def normalize_pipeline_steps(params: dict[str, Any]) -> list[dict[str, Any]]:
    raw_steps = params.get("steps")
    if not isinstance(raw_steps, list) or not raw_steps:
        raise ValueError("音频编排任务必须提供 steps")
    if len(raw_steps) > PIPELINE_STEP_LIMIT:
        raise ValueError(f"音频编排步骤最多支持 {PIPELINE_STEP_LIMIT} 步")

    steps: list[dict[str, Any]] = []
    for index, raw_step in enumerate(raw_steps, start=1):
        if not isinstance(raw_step, dict):
            raise ValueError(f"第 {index} 个编排步骤必须是对象")
        task_type = str(
            raw_step.get("task_type")
            or raw_step.get("taskType")
            or raw_step.get("type")
            or ""
        ).strip()
        if not task_type:
            subtype = str(raw_step.get("subtype") or "").strip()
            task_type = f"audio.{subtype}" if subtype else ""
        subtype = _audio_task_type_to_subtype(task_type)
        raw_params = raw_step.get("params") or {}
        if not isinstance(raw_params, dict):
            raise ValueError(f"第 {index} 个编排步骤的 params 必须是对象")
        steps.append(
            {
                "index": index,
                "task_type": f"audio.{subtype}",
                "subtype": subtype,
                "params": dict(raw_params),
            }
        )
    return steps


def _pipeline_output_name(
    params: dict[str, Any],
    step: dict[str, Any],
    *,
    final: bool,
) -> str:
    if final and params.get("outputFileName") not in (None, ""):
        return str(params["outputFileName"])
    original_stem = Path(str(params.get("inputFile") or "output")).stem or "output"
    if final:
        return original_stem
    return f"_pipeline_{step['index']:02d}_{step['subtype']}_{original_stem}"


def _prepare_pipeline(state: AudioPipelineState) -> dict[str, Any]:
    params = state["params"]
    return {
        "steps": normalize_pipeline_steps(params),
        "step_offset": 0,
        "current_input": str(params.get("inputFile") or ""),
        "outputs": [],
        "commands": [],
        "command": None,
    }


def _prepare_step(state: AudioPipelineState) -> dict[str, Any]:
    params = state["params"]
    steps = state["steps"]
    offset = state.get("step_offset", 0)
    step = steps[offset]
    final = offset == len(steps) - 1

    step_params = dict(step["params"])
    if final:
        for key in PIPELINE_FINAL_PARAM_KEYS:
            if key not in step_params and params.get(key) not in (None, ""):
                step_params[key] = params[key]
    step_params["inputFile"] = state["current_input"]
    step_params["task_type"] = step["task_type"]
    step_params.setdefault(
        "outputFormat",
        params.get("outputFormat") if final else "wav",
    )
    if step_params.get("outputFormat") in (None, ""):
        step_params["outputFormat"] = "mp3" if final else "wav"
    if final and params.get("outputFileName") not in (None, ""):
        step_params["outputFileName"] = str(params["outputFileName"])
    elif step_params.get("outputFileName") in (None, ""):
        step_params["outputFileName"] = _pipeline_output_name(
            params,
            step,
            final=final,
        )

    return {"current_step": step, "current_step_params": step_params}


def _route_after_step(state: AudioPipelineState) -> str:
    if state.get("step_offset", 0) >= len(state.get("steps", [])):
        return "summarize"
    return "prepare_step"


def compile_audio_pipeline_graph(
    *,
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
    process_holder: list[Any] | None = None,
    is_cancelled: Callable[[], bool] | None = None,
):
    def _run_step(state: AudioPipelineState) -> dict[str, Any]:
        if is_cancelled and is_cancelled():
            raise RuntimeError("任务已取消")

        step = state["current_step"]
        steps = state["steps"]
        offset = state.get("step_offset", 0)
        base_progress = 100.0 * offset / len(steps)
        if on_log:
            on_log(f"[pipeline] 第 {step['index']}/{len(steps)} 步：{step['task_type']}")

        def _step_progress(percent: float) -> None:
            if on_progress:
                on_progress(base_progress + percent / len(steps))

        graph = compile_audio_router_graph(
            on_log=on_log,
            on_progress=_step_progress if on_progress else None,
            process_holder=process_holder,
        )
        step_state = graph.invoke(
            {"task_id": state["task_id"], "params": state["current_step_params"]}
        )
        return {"last_step_state": step_state}

    def _record_step(state: AudioPipelineState) -> dict[str, Any]:
        step = state["current_step"]
        step_state = state["last_step_state"]
        command = step_state.get("command") or []
        commands = [*state.get("commands", [])]
        if command:
            commands.append(command)

        target_path = str(step_state.get("target_path") or "")
        if not target_path:
            step_outputs = step_state.get("outputs") or []
            target_path = str(step_outputs[0]["path"]) if step_outputs else ""
        if not target_path:
            raise RuntimeError(f"第 {step['index']} 步没有生成输出文件")

        output_path = Path(target_path)
        outputs = [
            *state.get("outputs", []),
            {
                "path": str(output_path),
                "size": output_path.stat().st_size if output_path.exists() else 0,
                "step": step["index"],
                "task_type": step["task_type"],
            },
        ]
        return {
            "commands": commands,
            "command": commands[-1] if commands else None,
            "outputs": outputs,
            "current_input": str(output_path),
            "target_path": str(output_path),
            "step_offset": state.get("step_offset", 0) + 1,
        }

    def _summarize(state: AudioPipelineState) -> dict[str, Any]:
        return {
            "command": state.get("command"),
            "outputs": state.get("outputs", []),
            "target_path": state.get("target_path") or state.get("current_input"),
        }

    builder = StateGraph(AudioPipelineState)
    builder.add_node("prepare_pipeline", _prepare_pipeline)
    builder.add_node("prepare_step", _prepare_step)
    builder.add_node("run_step", _run_step)
    builder.add_node("record_step", _record_step)
    builder.add_node("summarize", _summarize)

    builder.add_edge(START, "prepare_pipeline")
    builder.add_edge("prepare_pipeline", "prepare_step")
    builder.add_edge("prepare_step", "run_step")
    builder.add_edge("run_step", "record_step")
    builder.add_conditional_edges(
        "record_step",
        _route_after_step,
        {"prepare_step": "prepare_step", "summarize": "summarize"},
    )
    builder.add_edge("summarize", END)
    return builder.compile()
