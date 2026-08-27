"""Vocal separation runner subprocess.

Protocol:
- stdin: one JSON payload with the separation request.
- stdout: NDJSON events (``log`` / ``progress`` / ``outputs`` / ``error``).
  ``progress`` events carry both the global percent and the current ``stage``
  label so the UI can explain *what* the percentage represents (downloading
  the model, loading it, reading audio, inferring, writing results).
- stderr: raw library warnings (collected by the parent for error reports).
- exit code 0 on success, 1 on failure.

Run as a standalone script from ``backend.msst``; never imported in-process so
the Flask server stays free of Torch.
"""

from __future__ import annotations

import contextlib
import json
import logging
import sys
from pathlib import Path

_REAL_STDOUT = sys.stdout


def _emit(payload: dict) -> None:
    _REAL_STDOUT.write(json.dumps(payload, ensure_ascii=False) + "\n")
    _REAL_STDOUT.flush()


def _log(message: str) -> None:
    _emit({"type": "log", "message": message})


def _progress(percent: float, stage: str = "") -> None:
    _emit(
        {
            "type": "progress",
            "percent": max(0.0, min(100.0, float(percent))),
            "stage": str(stage or ""),
        }
    )


class _NdjsonLogHandler(logging.Handler):
    """Forward pymss library logs (INFO+) into the NDJSON stream."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            if record.levelno < logging.INFO:
                return
            _log(f"[pymss] {record.getMessage()}")
        except Exception:  # noqa: BLE001 - 日志转发失败不能影响推理
            pass


def _attach_library_logging() -> None:
    # pymss 的共享 logger 名就叫 "logger"（见 pymss.logger.get_separation_logger）。
    logger = logging.getLogger("logger")
    if any(isinstance(handler, _NdjsonLogHandler) for handler in logger.handlers):
        return
    logger.addHandler(_NdjsonLogHandler(level=logging.INFO))


def _run(payload: dict) -> None:
    import numpy as np
    from pymss import MSSeparator, load_audio
    from pymss.model_download import download_model
    from pymss.model_registry import resolve_model

    input_path = Path(str(payload["inputPath"]))
    output_dir = Path(str(payload["outputDir"]))
    model_name = str(payload.get("modelName") or "").strip()
    model_dir = str(payload.get("modelDir") or "") or None
    device = str(payload.get("device") or "auto")
    output_format = str(payload.get("outputFormat") or "wav").strip().lower()
    output_name = str(payload.get("outputName") or "").strip()
    download_source = str(payload.get("downloadSource") or "modelscope")
    use_tta = bool(payload.get("useTta"))
    inference_params = dict(payload.get("inferenceParams") or {})

    if not input_path.is_file():
        raise FileNotFoundError(f"输入文件不存在：{input_path}")
    if not model_name:
        raise ValueError("缺少分离模型名称")
    if output_format not in {"wav", "flac", "mp3"}:
        raise ValueError(f"不支持的输出格式：{output_format}")
    output_dir.mkdir(parents=True, exist_ok=True)

    _attach_library_logging()

    # ---- 阶段 1：下载模型（仅本地缓存缺失时），占 0-50% ----
    resolved = resolve_model(
        model_name, model_dir=model_dir, require_supported=True, require_exists=False
    )
    required_paths = [
        path
        for path in (resolved.get("model_path"), resolved.get("config_path"))
        if path
    ]
    needs_download = any(not Path(path).is_file() for path in required_paths)
    download_end = 50.0 if needs_download else 0.0

    if needs_download:
        download_state = {"fraction": 0.0}

        def download_progress(done: int, total: int, message: str) -> None:
            try:
                done_bytes = float(done)
                total_bytes = float(total)
            except (TypeError, ValueError):
                return
            if total_bytes > 0:
                # 多文件下载时每个文件都从 0 计数，取最大值避免进度回退
                download_state["fraction"] = max(
                    download_state["fraction"], min(1.0, done_bytes / total_bytes)
                )
                stage = (
                    f"下载模型（{done_bytes / 1048576:.0f}/{total_bytes / 1048576:.0f} MB）"
                )
            else:
                stage = "下载模型"
            _progress(download_state["fraction"] * download_end, stage)

        _log(f"[vocal_separation] 模型未缓存，开始下载：{model_name}")
        _progress(0.0, "下载模型")
        download_model(
            model_name,
            model_dir=model_dir,
            source=download_source,
            progress_callback=download_progress,
        )
        _progress(download_end, "下载模型")

    # ---- 阶段 2：加载模型（含 Torch 权重加载），约 5% 区间 ----
    load_start = download_end + 1.0 if needs_download else 1.0
    load_end = load_start + 5.0
    infer_start = load_end + 5.0
    infer_end = 95.0

    def demix_progress(done, total, message) -> None:
        try:
            done_seconds = float(done)
            total_seconds = float(total)
        except (TypeError, ValueError):
            return
        if total_seconds <= 0:
            return
        fraction = min(1.0, done_seconds / total_seconds)
        stage = f"分离推理（{done_seconds:.0f}/{total_seconds:.0f} 秒）"
        _progress(infer_start + fraction * (infer_end - infer_start), stage)

    _log(f"[vocal_separation] 加载模型：{model_name}（设备：{device}）")
    if use_tta:
        _log("[vocal_separation] 已启用测试时增强（TTA），耗时约 3 倍")
    if inference_params:
        _log(f"[vocal_separation] 推理参数覆盖：{inference_params}")
    _progress(load_start, "加载模型")
    separator = MSSeparator.from_model_name(
        model_name,
        model_dir=model_dir,
        download=False,
        device=device,
        output_format=output_format,
        use_tta=use_tta,
        inference_params=inference_params,
        progress_callback=demix_progress,
    )
    try:
        # ---- 阶段 3：读取音频 ----
        sample_rate = 44100
        audio_config = getattr(separator.config, "audio", None)
        if isinstance(audio_config, dict):
            try:
                sample_rate = int(audio_config.get("sample_rate", 44100))
            except (TypeError, ValueError):
                sample_rate = 44100
        _log(f"[vocal_separation] 读取音频（模型采样率 {sample_rate} Hz）")
        _progress(load_end, "读取音频")
        mix, sr = load_audio(str(input_path), sr=sample_rate, mono=False)
        _progress(infer_start, "读取音频")

        # ---- 阶段 4：分离推理，占 infer_start-95% ----
        _log("[vocal_separation] 正在分离人声与伴奏……")
        _progress(infer_start, "分离推理")
        results = separator.separate(mix, pbar=False)
        _progress(infer_end, "分离推理")

        vocals_key = next(
            (key for key in results if str(key).strip().lower() == "vocals"),
            None,
        )
        if vocals_key is None:
            raise RuntimeError("分离模型没有返回人声 stem，请更换模型")
        vocals = results.pop(vocals_key)
        others = list(results.values())
        if others:
            instrumental = (
                others[0]
                if len(others) == 1
                else np.sum(np.stack(others, axis=0), axis=0)
            )
        else:
            # 模型只给出人声：用“原曲 - 人声”近似伴奏
            instrumental = np.asarray(mix, dtype=np.float32).T - np.asarray(
                vocals, dtype=np.float32
            )

        # ---- 阶段 5：写出结果 ----
        _progress(infer_end, "写出结果")
        base_name = output_name or input_path.stem or "output"
        base_name = Path(base_name).name.strip() or (input_path.stem or "output")
        outputs: list[dict] = []
        for stem, audio in (("vocals", vocals), ("instrumental", instrumental)):
            file_name = f"{base_name}_{stem}"
            separator.save_audio(audio, sr, file_name, str(output_dir))
            path = output_dir / f"{file_name}.{output_format}"
            if not path.is_file():
                raise RuntimeError(f"未能写出分离结果：{path}")
            outputs.append(
                {"path": str(path), "stem": stem, "size": path.stat().st_size}
            )
        _emit({"type": "outputs", "outputs": outputs})
        _progress(99.0, "写出结果")
        _log("[vocal_separation] 分离完成")
        _progress(100.0, "分离完成")
    finally:
        try:
            separator.close()
        except Exception:  # noqa: BLE001 - 清理失败不影响结果
            pass


def main() -> int:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)
        # 拦截第三方库写 stdout，保证 NDJSON 协议不被污染
        with contextlib.redirect_stdout(sys.stderr):
            _run(payload)
    except Exception as exc:  # noqa: BLE001 - 错误要回传给父进程
        _emit({"type": "error", "message": str(exc)})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
