"""MSST vocal separation integration.

The Flask process never loads Torch models itself. Model catalog lookups parse
the installed pymss CLI's ``list --json`` output in a short-lived subprocess
(see ``catalog.py``), while the heavy inference runs in the ``runner.py``
subprocess that speaks a small NDJSON protocol on stdout.

Public surface used by the workflow layer:

- ``run_vocal_separation(...)``: spawn the runner subprocess and stream
  log/progress events back through callbacks.
- ``describe_msst_runtime()``: catalog snapshot for the frontend API.
- ``describe_pymss_catalog()``: full pymss catalog grouped by category.
- ``validate_msst_model(...)``: cheap pre-flight check for task params.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

from ..config import PROJECT_ROOT, resolve_project_path
from .catalog import (
    VOCAL_SEPARATION_CATEGORY,
    get_catalog,
    is_model_downloaded,
    model_config_info,
    models_for_category,
)

# 人声/伴奏双向分离的 pymss catalog secondary_category
MSST_MODEL_CATEGORY = VOCAL_SEPARATION_CATEGORY
# 输出固定为“人声 + 伴奏”两条音轨；与 pymss 支持的无损/有损格式对齐
MSST_OUTPUT_FORMATS = ("wav", "flac", "mp3")
MSST_DEVICES = ("auto", "cpu", "cuda", "mps", "mlx")
DEFAULT_MSST_MODEL = "MDX23C-8KFFT-InstVoc_HQ.ckpt"
DEFAULT_MSST_DEVICE = "auto"
DEFAULT_MSST_OUTPUT_FORMAT = "wav"
DEFAULT_DOWNLOAD_SOURCE = "modelscope"
RUNNER_TIMEOUT_SECONDS = 6 * 3600

RUNNER_PATH = Path(__file__).resolve().parent / "runner.py"


class MsstError(RuntimeError):
    """Vocal separation failure with a user-facing message."""


def resolve_model_dir() -> Path:
    """Resolve the local MSST model cache directory (created on demand)."""
    env_dir = os.environ.get("WAVEBANK_MSST_MODEL_DIR", "").strip()
    if env_dir:
        model_dir = Path(env_dir).expanduser()
        if not model_dir.is_absolute():
            model_dir = PROJECT_ROOT / env_dir
        model_dir.mkdir(parents=True, exist_ok=True)
        return model_dir
    settings_dir = resolve_project_path("backend/data")
    model_dir = (settings_dir or PROJECT_ROOT / "backend" / "data") / "msst" / "models"
    model_dir.mkdir(parents=True, exist_ok=True)
    return model_dir


def _model_summary(item: dict[str, Any], model_dir: Path) -> dict[str, Any]:
    """Shape one catalog entry for the frontend API."""
    config = model_config_info(item, model_dir)
    return {
        "name": item["name"],
        "aliases": item.get("aliases", []),
        "modelType": item.get("modelType", ""),
        "architecture": item["architecture"],
        "sizeBytes": item["sizeBytes"],
        "targetStem": item["targetStem"],
        "primaryCategory": item["primaryCategory"],
        "primaryCategoryCn": item["primaryCategoryCn"],
        "secondaryCategory": item["secondaryCategory"],
        "secondaryCategoryCn": item["secondaryCategoryCn"],
        "categoryPath": item["categoryPath"],
        "downloaded": is_model_downloaded(item, model_dir),
        "config": config or None,
        "paramCapabilities": item.get("paramCapabilities", {}),
        "defaultInferenceParams": (config or {}).get("inferenceDefaults") or None,
    }


def list_msst_models() -> list[dict[str, Any]]:
    """Return the supported vocal/instrumental models as plain metadata.

    ``defaultInferenceParams`` carries the model YAML's own recommended
    values (only readable once the model is downloaded); the frontend shows
    them in the advanced-parameter tooltips.
    """
    model_dir = resolve_model_dir()
    catalog = get_catalog(model_dir)
    models = models_for_category(catalog, MSST_MODEL_CATEGORY)
    return [_model_summary(item, model_dir) for item in models]


def describe_msst_runtime() -> dict[str, Any]:
    """Snapshot for the vocal separation page: model list + default model."""
    model_dir = resolve_model_dir()
    try:
        catalog = get_catalog(model_dir)
        models = [
            _model_summary(item, model_dir)
            for item in models_for_category(catalog, MSST_MODEL_CATEGORY)
        ]
        available = True
        error = ""
    except Exception as exc:  # noqa: BLE001 - 前端需要可读错误
        catalog = {}
        models = []
        available = False
        error = str(exc)
    known_names = {model["name"] for model in models}
    default_model = (
        DEFAULT_MSST_MODEL
        if DEFAULT_MSST_MODEL in known_names
        else (models[0]["name"] if models else DEFAULT_MSST_MODEL)
    )
    return {
        "available": available,
        "models": models,
        "defaultModel": default_model,
        "modelDir": str(model_dir),
        "source": catalog.get("source", "") if available else "",
        "fetchedAt": catalog.get("fetchedAt", "") if available else "",
        "error": error,
    }


def describe_pymss_catalog() -> dict[str, Any]:
    """Full pymss catalog grouped by category, for future feature pages."""
    model_dir = resolve_model_dir()
    try:
        catalog = get_catalog(model_dir)
        catalog = {
            **catalog,
            "available": True,
            "error": "",
            "modelDir": str(model_dir),
            "models": [_model_summary(item, model_dir) for item in catalog["models"]],
            "categories": [
                {
                    **primary,
                    "secondaryCategories": [
                        {
                            **secondary,
                            "models": [
                                _model_summary(item, model_dir)
                                for item in secondary["models"]
                            ],
                        }
                        for secondary in primary["secondaryCategories"]
                    ],
                }
                for primary in catalog["categories"]
            ],
        }
        return catalog
    except Exception as exc:  # noqa: BLE001 - 前端需要可读错误
        return {
            "available": False,
            "source": "",
            "fetchedAt": "",
            "modelCount": 0,
            "models": [],
            "categories": [],
            "modelDir": str(model_dir),
            "error": str(exc),
        }


def validate_msst_model(model_name: str) -> str:
    """Validate the requested model name against the catalog (best effort)."""
    name = str(model_name or "").strip()
    if not name:
        raise MsstError("缺少分离模型名称")
    catalog = get_catalog(resolve_model_dir())
    models = models_for_category(catalog, MSST_MODEL_CATEGORY)
    if not models and catalog.get("source") == "none":
        # pymss 未安装/不可解析：交给 runner 报出明确的底层错误
        return name
    known = {str(item["name"]).strip().lower(): item["name"] for item in models}
    for item in models:
        for alias in item.get("aliases", []):
            if str(alias).strip().lower() == name.lower():
                return str(item["name"])
    if name.lower() in known:
        return known[name.lower()]
    raise MsstError(
        f"未知或不支持的人声分离模型：{model_name}（仅支持人声/伴奏双向分离类模型）"
    )


def msst_model_downloaded(model_name: str) -> bool:
    """Whether the model weights already exist in the local cache."""
    name = str(model_name or "").strip()
    if not name:
        return False
    catalog = get_catalog(resolve_model_dir())
    models = models_for_category(catalog, MSST_MODEL_CATEGORY)
    entry = next(
        (
            item
            for item in models
            if str(item["name"]).lower() == name.lower()
        ),
        None,
    )
    if entry is None:
        return False
    return is_model_downloaded(entry, resolve_model_dir())


def run_vocal_separation(
    *,
    input_path: str,
    output_dir: str,
    model_name: str,
    device: str = DEFAULT_MSST_DEVICE,
    output_format: str = DEFAULT_MSST_OUTPUT_FORMAT,
    output_name: str = "",
    download_source: str = DEFAULT_DOWNLOAD_SOURCE,
    use_tta: bool = False,
    inference_params: dict[str, Any] | None = None,
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
    on_stage: Callable[[str], None] | None = None,
    process_holder: list[subprocess.Popen[str]] | None = None,
    timeout_seconds: int = RUNNER_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """Run vocal separation in a subprocess and stream events back.

    Returns ``{"outputs": [{"path", "stem", "size"}, ...], "targetPath": str}``
    where ``targetPath`` points at the vocals track.
    """

    def log(message: str) -> None:
        if on_log:
            on_log(message)

    payload = {
        "inputPath": str(input_path),
        "outputDir": str(output_dir),
        "modelName": str(model_name),
        "modelDir": str(resolve_model_dir()),
        "device": str(device or DEFAULT_MSST_DEVICE),
        "outputFormat": str(output_format or DEFAULT_MSST_OUTPUT_FORMAT),
        "outputName": str(output_name or ""),
        "downloadSource": str(download_source or DEFAULT_DOWNLOAD_SOURCE),
        "useTta": bool(use_tta),
        # 只传调用方显式给出的键；未包含的键沿用模型 catalog 推荐值
        "inferenceParams": {k: v for k, v in (inference_params or {}).items()},
    }

    if not msst_model_downloaded(model_name):
        log(f"[vocal_separation] 模型未缓存，将自动下载：{model_name}")

    command = [sys.executable, "-X", "utf8", str(RUNNER_PATH)]
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(PROJECT_ROOT),
        )
    except OSError as exc:
        raise MsstError(f"无法启动人声分离子进程：{exc}") from exc
    if process_holder is not None:
        process_holder.append(process)

    assert process.stdin is not None
    try:
        process.stdin.write(json.dumps(payload, ensure_ascii=False))
        process.stdin.flush()
    except (BrokenPipeError, OSError):
        # 子进程启动即失败：继续读 stdout/stderr 拿错误信息
        pass
    finally:
        try:
            process.stdin.close()
        except (BrokenPipeError, OSError):
            pass

    stderr_lines: list[str] = []
    stdout_queue: queue.Queue[tuple[str, str] | None] = queue.Queue()

    def pump_stdout() -> None:
        assert process.stdout is not None
        for line in process.stdout:
            clean = line.strip()
            if clean:
                stdout_queue.put(("line", clean))
        stdout_queue.put(None)

    def pump_stderr() -> None:
        assert process.stderr is not None
        for line in process.stderr:
            clean = line.rstrip()
            if clean:
                stderr_lines.append(clean)

    stdout_thread = threading.Thread(target=pump_stdout, daemon=True)
    stderr_thread = threading.Thread(target=pump_stderr, daemon=True)
    stdout_thread.start()
    stderr_thread.start()

    outputs: list[dict[str, Any]] = []
    error_message = ""
    started = time.monotonic()

    def raise_msst(message: str) -> None:
        tail = "\n".join(stderr_lines[-20:])
        if tail:
            message = f"{message}\n{tail}"
        raise MsstError(message)

    try:
        while True:
            remaining = timeout_seconds - (time.monotonic() - started)
            if remaining <= 0:
                process.terminate()
                raise_msst(f"人声分离执行超时（{timeout_seconds}s）")
            try:
                item = stdout_queue.get(timeout=min(1.0, max(0.1, remaining)))
            except queue.Empty:
                continue
            if item is None:
                break
            _, line = item
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                stderr_lines.append(line)
                continue
            kind = str(message.get("type", ""))
            if kind == "log":
                log(str(message.get("message", "")))
            elif kind == "progress":
                if on_progress:
                    try:
                        on_progress(float(message.get("percent", 0.0)))
                    except (TypeError, ValueError):
                        pass
                stage = str(message.get("stage") or "").strip()
                if on_stage and stage:
                    on_stage(stage)
            elif kind == "outputs":
                outputs = list(message.get("outputs") or [])
            elif kind == "error":
                error_message = str(message.get("message", ""))

        try:
            returncode = process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            returncode = -1
    finally:
        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)
        if process_holder is not None and process in process_holder:
            process_holder.remove(process)

    if error_message:
        raise_msst(error_message)
    if returncode != 0:
        raise_msst(f"人声分离子进程异常退出（退出码 {returncode}）")
    if not outputs:
        raise_msst("人声分离没有生成输出文件")

    vocals = next(
        (item for item in outputs if item.get("stem") == "vocals"), outputs[0]
    )
    return {
        "outputs": outputs,
        "targetPath": str(vocals.get("path", "")),
    }


__all__ = [
    "DEFAULT_MSST_DEVICE",
    "DEFAULT_MSST_MODEL",
    "DEFAULT_MSST_OUTPUT_FORMAT",
    "MSST_DEVICES",
    "MSST_OUTPUT_FORMATS",
    "MsstError",
    "describe_msst_runtime",
    "describe_pymss_catalog",
    "list_msst_models",
    "msst_model_downloaded",
    "resolve_model_dir",
    "run_vocal_separation",
    "validate_msst_model",
]
