"""Model downloader subprocess for the settings page.

Protocol:
- stdin: one JSON payload with the download request.
- stdout: NDJSON events (``log`` / ``progress`` / ``done`` / ``error``).
  ``progress`` events carry the overall percent and a human-readable stage.
- exit code 0 on success, 1 on failure.

Run as a standalone script from ``backend.msst``; never imported in-process so
the Flask server stays free of Torch.
"""

from __future__ import annotations

import contextlib
import json
import sys

_REAL_STDOUT = sys.stdout


def _emit(payload: dict) -> None:
    _REAL_STDOUT.write(json.dumps(payload, ensure_ascii=False) + "\n")
    _REAL_STDOUT.flush()


def main() -> int:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)
        model_name = str(payload.get("modelName") or "").strip()
        model_dir = str(payload.get("modelDir") or "") or None
        download_source = str(payload.get("downloadSource") or "modelscope")
        try:
            timeout = int(payload.get("timeoutSeconds") or 30)
        except (TypeError, ValueError):
            timeout = 30
        if not model_name:
            raise ValueError("缺少模型名称")

        # Torch 等重依赖只在本子进程加载
        with contextlib.redirect_stdout(sys.stderr):
            from pymss.model_download import download_model

            state = {"fraction": 0.0}

            def progress(done: int, total: int, message: str) -> None:
                try:
                    done_bytes = float(done)
                    total_bytes = float(total)
                except (TypeError, ValueError):
                    return
                if total_bytes > 0:
                    state["fraction"] = max(
                        state["fraction"], min(1.0, done_bytes / total_bytes)
                    )
                    stage = (
                        f"{message}（{done_bytes / 1048576:.0f}/"
                        f"{total_bytes / 1048576:.0f} MB）"
                    )
                else:
                    stage = str(message or "下载中")
                _emit(
                    {
                        "type": "progress",
                        "percent": state["fraction"] * 100.0,
                        "stage": stage,
                    }
                )

            _emit({"type": "log", "message": f"开始下载模型：{model_name}"})
            result = download_model(
                model_name,
                model_dir=model_dir,
                source=download_source,
                timeout=timeout,
                progress_callback=progress,
            )
            downloaded = list(result.get("downloaded") or [])
            skipped = list(result.get("skipped") or [])
            _emit(
                {
                    "type": "done",
                    "message": (
                        f"下载完成：新增 {len(downloaded)} 个文件，"
                        f"跳过 {len(skipped)} 个已存在文件"
                    ),
                    "downloaded": downloaded,
                    "skipped": skipped,
                }
            )
    except Exception as exc:  # noqa: BLE001 - 错误要回传给父进程
        _emit({"type": "error", "message": str(exc)})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
