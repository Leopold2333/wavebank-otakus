"""Probe available inference devices in a short-lived subprocess.

The Flask process intentionally never imports Torch; this script is spawned on
demand (and its result is cached for a few minutes) so the vocal separation
page can show the real GPU name next to the CUDA option.

Stdout contract: a single JSON object with a ``devices`` list.
"""

from __future__ import annotations

import json
import platform
import shutil
import subprocess


DEFAULT_DEVICES: list[dict] = [
    {"value": "auto", "label": "自动", "available": True, "names": []},
    {"value": "cpu", "label": "CPU", "available": True, "names": []},
    {"value": "cuda", "label": "CUDA", "available": False, "names": []},
    {"value": "mps", "label": "MPS", "available": False, "names": []},
    {"value": "mlx", "label": "MLX", "available": False, "names": []},
]


def _nvidia_gpu_names() -> list[str]:
    """Best-effort GPU name lookup without importing torch."""
    executable = shutil.which("nvidia-smi")
    if not executable:
        return []
    try:
        proc = subprocess.run(
            [
                executable,
                "--query-gpu=name",
                "--format=csv,noheader",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if proc.returncode != 0:
        return []
    return [line.strip() for line in proc.stdout.splitlines() if line.strip()]


def _probe() -> dict:
    devices = {item["value"]: dict(item) for item in DEFAULT_DEVICES}
    system = platform.system()

    # MPS / MLX 只在 macOS 上才有意义；Windows / Linux 下无论是否探测到都不可用
    if system != "Darwin":
        devices["mps"].update(available=False, names=[])
        devices["mlx"].update(available=False, names=[])

    try:
        import torch

        if torch.cuda.is_available():
            count = max(0, torch.cuda.device_count())
            names = [
                torch.cuda.get_device_name(index)
                for index in range(count)
            ]
            if names:
                devices["cuda"].update(available=True, names=names)

        mps_backend = getattr(getattr(torch, "backends", None), "mps", None)
        if mps_backend is not None and mps_backend.is_available():
            devices["mps"].update(available=True, names=["Apple Silicon"])
    except Exception:  # noqa: BLE001 - 探测失败就保留默认标签
        pass

    if not devices["cuda"]["names"]:
        names = _nvidia_gpu_names()
        if names:
            devices["cuda"].update(available=True, names=names)

    if devices["cuda"]["names"]:
        devices["cuda"]["label"] = (
            " / ".join(devices["cuda"]["names"]) + "（CUDA）"
        )
        devices["cuda"]["searchText"] = "cuda " + " ".join(devices["cuda"]["names"])
    if devices["mps"]["names"]:
        devices["mps"]["label"] = "Apple Silicon（MPS）"
        devices["mps"]["searchText"] = "mps apple silicon"

    order = ("auto", "cpu", "cuda", "mps", "mlx")
    return {
        "probed": True,
        "devices": [devices[key] for key in order],
    }


if __name__ == "__main__":
    print(json.dumps(_probe(), ensure_ascii=False))
