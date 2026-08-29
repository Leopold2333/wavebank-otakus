"""Vocal separation (MSST) subgraph.

Unlike the ffmpeg-based subtypes this graph produces one or more model stems
(vocals / instrumental / other model-dependent tracks), so it owns its
prepare/execute/verify/summarize flow instead of reusing
``build_audio_graph``. Inference runs in the ``backend.msst`` runner
subprocess; the graph only orchestrates state, progress, logs and cancellation.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from langgraph.graph import END, START, StateGraph

from ...config import load_settings, resolve_project_path
from ...msst import (
    DEFAULT_MSST_DEVICE,
    DEFAULT_MSST_MODEL,
    DEFAULT_MSST_OUTPUT_FORMAT,
    MSST_DEVICES,
    MSST_OUTPUT_FORMATS,
    MsstError,
    run_vocal_separation,
    validate_msst_model,
)
from .common import AudioState


# pymss inference_params 的数值键；设为 None 表示沿用模型默认
_MSST_INT_PARAMS: tuple[tuple[str, str], ...] = (
    ("batchSize", "batch_size"),
    ("overlapSize", "overlap_size"),
    ("chunkSize", "chunk_size"),
)
_MSST_INT_PARAM_MAX = 16_777_216  # 约 6 分钟 @44.1kHz，防止无意义的巨值
_MSST_BOOL_PARAMS: tuple[tuple[str, str], ...] = (
    ("useTta", "use_tta"),
    ("standardize", "standardize"),
    ("normalize", "normalize"),
)


def _first_param_value(params: dict[str, Any], camel: str, snake: str) -> Any:
    if camel in params:
        return params[camel]
    return params.get(snake)


def _normalize_selected_stems(params: dict[str, Any]) -> list[str] | None:
    """Normalize the requested output stems; ``None`` means output all stems."""
    raw = params.get("selectedStems")
    if raw is None:
        raw = params.get("stems")
    if raw in (None, "", [], ()):
        return None
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, (list, tuple)):
        raise MsstError("输出音轨必须是字符串列表")
    stems = [
        str(item).strip().lower()
        for item in raw
        if str(item).strip()
    ]
    return stems or None


def _collect_inference_params(params: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    """Normalize and validate advanced inference parameters.

    Returns ``(use_tta, inference_params)`` where ``inference_params`` only
    holds explicitly requested overrides (pymss falls back to the model's
    recommended values for missing keys).
    """
    inference: dict[str, Any] = {}
    for camel, snake in _MSST_INT_PARAMS:
        value = _first_param_value(params, camel, snake)
        if value in (None, ""):
            continue
        try:
            number = int(value)
        except (TypeError, ValueError) as exc:
            raise MsstError(f"{camel} 必须是正整数（留空使用模型默认值）") from exc
        if number < 1 or number > _MSST_INT_PARAM_MAX:
            raise MsstError(
                f"{camel} 需在 1 ~ {_MSST_INT_PARAM_MAX} 之间（留空使用模型默认值）"
            )
        inference[snake] = number
    for camel, snake in _MSST_BOOL_PARAMS:
        if snake == "use_tta":
            continue
        if camel in params or snake in params:
            inference[snake] = bool(_first_param_value(params, camel, snake))
    use_tta = bool(_first_param_value(params, "useTta", "use_tta"))
    return use_tta, inference


def collect_params(state: AudioState) -> dict[str, Any]:
    params = state.get("params", {})
    params.setdefault("modelName", DEFAULT_MSST_MODEL)
    params.setdefault("device", DEFAULT_MSST_DEVICE)
    params.setdefault("outputFormat", DEFAULT_MSST_OUTPUT_FORMAT)
    return {"params": params}


def _resolve_output_basename(params: dict[str, Any], input_path: Path) -> str:
    output_file_name = str(
        params.get("outputFileName") or params.get("output_file_name") or ""
    ).strip()
    if output_file_name:
        safe_name = Path(output_file_name).name.strip()
        if safe_name in {"", ".", ".."}:
            raise MsstError("输出文件名不能为空，也不能包含路径")
        return Path(safe_name).stem or safe_name
    return input_path.stem or "output"


def prepare(state: AudioState) -> dict[str, Any]:
    params = state["params"]
    input_path = resolve_project_path(params.get("inputFile"))
    if input_path is None or not input_path.is_file():
        raise FileNotFoundError(f"输入文件不存在：{params.get('inputFile')}")

    model_name = validate_msst_model(
        str(params.get("modelName") or DEFAULT_MSST_MODEL).strip()
    )

    device = str(params.get("device") or DEFAULT_MSST_DEVICE).strip().lower()
    if device not in MSST_DEVICES:
        raise MsstError(
            f"不支持的推理设备：{device}（可选：{' / '.join(MSST_DEVICES)}）"
        )

    output_format = str(
        params.get("outputFormat") or DEFAULT_MSST_OUTPUT_FORMAT
    ).strip().lstrip(".").lower()
    if output_format not in MSST_OUTPUT_FORMATS:
        raise MsstError(
            f"不支持的输出格式：{output_format}（可选：{' / '.join(MSST_OUTPUT_FORMATS)}）"
        )

    settings = load_settings()
    task_root = resolve_project_path(settings["paths"].get("tmp_dir", "tmp"))
    if task_root is None:
        task_root = resolve_project_path("tmp")
    if task_root is None:
        task_root = Path("tmp")
    task_dir = task_root / state["task_id"]
    task_dir.mkdir(parents=True, exist_ok=True)

    base = _resolve_output_basename(params, input_path)
    selected_stems = _normalize_selected_stems(params)
    first_stem = selected_stems[0] if selected_stems else "vocals"
    first_output_path = task_dir / f"{base}_{first_stem}.{output_format}"
    return {
        "input_path": str(input_path),
        "output_path": str(first_output_path),
        "target_path": str(first_output_path),
    }


def make_execute_node(
    *,
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
    on_stage: Callable[[str], None] | None = None,
    process_holder: list[Any] | None = None,
) -> Callable[[AudioState], dict[str, Any]]:
    def _execute(state: AudioState) -> dict[str, Any]:
        params = state["params"]
        input_path = Path(state["input_path"])
        use_tta, inference_params = _collect_inference_params(params)
        selected_stems = _normalize_selected_stems(params)
        result = run_vocal_separation(
            input_path=str(input_path),
            output_dir=str(Path(state["output_path"]).parent),
            model_name=str(params.get("modelName") or DEFAULT_MSST_MODEL),
            device=str(params.get("device") or DEFAULT_MSST_DEVICE),
            output_format=str(params.get("outputFormat") or DEFAULT_MSST_OUTPUT_FORMAT),
            output_name=_resolve_output_basename(params, input_path),
            use_tta=use_tta,
            inference_params=inference_params,
            selected_stems=selected_stems,
            on_log=on_log,
            on_progress=on_progress,
            on_stage=on_stage,
            process_holder=process_holder,
        )
        return {
            "outputs": result["outputs"],
            "target_path": result["targetPath"],
            "progress": 100.0,
        }

    return _execute


def verify(state: AudioState) -> dict[str, Any]:
    outputs = state.get("outputs") or []
    if not outputs:
        raise RuntimeError("人声分离没有生成任何输出文件")
    for output in outputs:
        path = Path(str(output.get("path", "")))
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"输出文件缺失或为空：{path}")
    return {}


def summarize(state: AudioState) -> dict[str, Any]:
    outputs = state.get("outputs", [])
    vocals = next(
        (item for item in outputs if item.get("stem") == "vocals"),
        None,
    )
    target_path = (
        (vocals or (outputs[0] if outputs else None) or {}).get("path")
        or state.get("target_path")
    )
    return {
        "progress": 100.0,
        "outputs": outputs,
        "target_path": target_path,
    }


def compile_vocal_separation_graph(
    *,
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
    on_stage: Callable[[str], None] | None = None,
    process_holder: list[Any] | None = None,
):
    """Build the vocal separation graph (prepare -> execute -> verify -> summarize)."""
    builder = StateGraph(AudioState)
    builder.add_node("collect_params", collect_params)
    builder.add_node("prepare", prepare)
    builder.add_node(
        "execute",
        make_execute_node(
            on_log=on_log,
            on_progress=on_progress,
            on_stage=on_stage,
            process_holder=process_holder,
        ),
    )
    builder.add_node("verify", verify)
    builder.add_node("summarize", summarize)

    builder.add_edge(START, "collect_params")
    builder.add_edge("collect_params", "prepare")
    builder.add_edge("prepare", "execute")
    builder.add_edge("execute", "verify")
    builder.add_edge("verify", "summarize")
    builder.add_edge("summarize", END)
    return builder.compile()
