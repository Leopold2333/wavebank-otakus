"""Runtime parser for the pymss model catalog.

The pymss model library evolves over time, so instead of hard-coding model
names the backend parses the installed pymss CLI's ``list --json`` output
(falling back to its bundled ``model_catalog.json``). The parser keeps every
model category so future feature pages can reuse the same snapshot; the vocal
separation page filters by ``secondary_category == "vocal_instrumental_dual"``.

The heavy pymss import (and Torch) only ever happens in a short-lived
subprocess; the Flask process itself stays light.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import yaml

# pymss 中“人声/伴奏双向分离”模型的二级分类；人声分离页专用
VOCAL_SEPARATION_CATEGORY = "vocal_instrumental_dual"

# 少数分类的默认模型有明确更合适的候选；未覆盖的分类取该小类第一个模型。
DEFAULT_MODEL_OVERRIDES: dict[str, str] = {
    "vocal_instrumental_dual": "MDX23C-8KFFT-InstVoc_HQ.ckpt",
}

_CATALOG_TTL_SECONDS = 300
_CACHE: dict[str, Any] = {"at": 0.0, "model_dir": None, "catalog": None}

# MSS 风格架构：batch_size / overlap_size / chunk_size 均参与分块推理
_MSS_CHUNKED_TYPES = frozenset(
    {
        "apollo",
        "bandit",
        "bandit_v2",
        "bs_conformer",
        "bs_roformer",
        "bs_roformer_hyperace",
        "mdx23c",
        "mel_band_conformer",
        "mel_band_roformer",
        "scnet",
    }
)

# Demucs 系架构：batch_size / overlap_size 生效，chunk_size 由 training.segment 决定
_DEMUCS_TYPES = frozenset({"demucs", "htdemucs", "legacy_demucs", "legacy_tasnet", "tasnet"})


def _run_pymss_list_json() -> list[dict[str, Any]] | None:
    """Run ``pymss list --json`` and return the raw model rows."""
    candidates: list[list[str]] = []
    console_script = None
    executable_dir = Path(sys.executable).resolve().parent
    same_env_script = executable_dir / "pymss"
    if same_env_script.is_file():
        console_script = str(same_env_script)
    else:
        console_script = shutil.which("pymss")
    if console_script:
        candidates.append([console_script, "list", "--json"])
    candidates.append(
        [
            sys.executable,
            "-c",
            "import sys; from pymss.cli import main; sys.exit(main())",
            "list",
            "--json",
        ]
    )
    for command in candidates:
        try:
            proc = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=30,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if proc.returncode != 0:
            continue
        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError:
            continue
        if isinstance(data, list):
            return data
    return None


def _load_bundled_catalog() -> list[dict[str, Any]] | None:
    """Fallback: read pymss's bundled ``model_catalog.json`` without importing it."""
    try:
        spec = importlib.util.find_spec("pymss")
    except (ImportError, ValueError, ModuleNotFoundError):
        return None
    if spec is None or not spec.submodule_search_locations:
        return None
    package_dir = Path(next(iter(spec.submodule_search_locations)))
    catalog_path = package_dir / "resources" / "model_catalog.json"
    if not catalog_path.is_file():
        return None
    try:
        with catalog_path.open(encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    models = data.get("models") if isinstance(data, dict) else None
    return models if isinstance(models, list) else None


def _snapshot_path(model_dir: Path) -> Path:
    return Path(model_dir).parent / "pymss_catalog.json"


def _write_snapshot(model_dir: Path, catalog: dict[str, Any]) -> None:
    """Persist the parsed catalog next to the model dir (best effort)."""
    try:
        path = _snapshot_path(model_dir)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(catalog, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass


def _load_snapshot(model_dir: Path) -> dict[str, Any] | None:
    path = _snapshot_path(model_dir)
    if not path.is_file():
        return None
    try:
        with path.open(encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("models"), list):
        return None
    return data


def _is_downloaded(relpath: str, model_dir: Path) -> bool:
    return bool(relpath) and (model_dir / relpath).is_file()


def _read_model_config(
    relpath: str, config_relpath: str, model_dir: Path
) -> dict[str, Any] | None:
    """Read the model YAML (cached models only) and keep the useful bits.

    ``training.instruments`` is the authoritative stem list, while
    ``inferenceDefaults`` mirrors what pymss uses for chunked inference
    (batch_size / overlap_size / num_overlap / chunk_size).
    """
    if not relpath or not config_relpath:
        return None
    if not (model_dir / relpath).is_file():
        return None
    config_path = model_dir / config_relpath
    if not config_path.is_file():
        return None
    try:
        with config_path.open(encoding="utf-8") as handle:
            # FullLoader 兼容 pymss 模型配置里的 !!python/tuple（safe_load 会拒绝）
            raw = yaml.load(handle, Loader=yaml.FullLoader) or {}
    except (OSError, yaml.YAMLError):
        return None
    if not isinstance(raw, dict):
        return None

    training = raw.get("training") if isinstance(raw.get("training"), dict) else {}
    audio = raw.get("audio") if isinstance(raw.get("audio"), dict) else {}
    inference = raw.get("inference") if isinstance(raw.get("inference"), dict) else {}

    instruments = [
        str(item)
        for item in (training.get("instruments") or [])
        if str(item).strip()
    ]
    defaults: dict[str, int] = {}
    for key, value in (
        ("batchSize", inference.get("batch_size")),
        ("overlapSize", inference.get("overlap_size")),
        ("numOverlap", inference.get("num_overlap")),
        ("chunkSize", audio.get("chunk_size", inference.get("chunk_size"))),
    ):
        if isinstance(value, bool) or not isinstance(value, int):
            continue
        if value > 0:
            defaults[key] = value

    sample_rate = audio.get("sample_rate")
    return {
        "instruments": instruments,
        "sampleRate": (
            int(sample_rate)
            if isinstance(sample_rate, int) and not isinstance(sample_rate, bool)
            else None
        ),
        "inferenceDefaults": defaults or None,
    }


def _param_capabilities(architecture: str) -> dict[str, bool]:
    """Which advanced inference params apply for this architecture."""
    normalized = architecture.strip().lower()
    if normalized in _DEMUCS_TYPES:
        return {"batchSize": True, "overlapSize": True, "chunkSize": False}
    if normalized in _MSS_CHUNKED_TYPES:
        return {"batchSize": True, "overlapSize": True, "chunkSize": True}
    # 未知架构：保持三项可编辑，pymss 只会忽略不使用的键
    return {"batchSize": True, "overlapSize": True, "chunkSize": True}


def _normalize_model(raw: dict[str, Any], model_dir: Path) -> dict[str, Any] | None:
    name = str(raw.get("name") or "").strip()
    if not name or not raw.get("supported"):
        return None
    primary = str(raw.get("primary_category") or "").strip()
    secondary = str(raw.get("secondary_category") or "").strip()
    raw_architecture = str(raw.get("architecture") or "").strip()
    architecture = (
        raw_architecture
        if raw_architecture and raw_architecture.lower() != "unknown"
        else str(raw.get("model_type") or "").strip()
    )
    relpath = str(raw.get("relpath") or "").strip()
    config_relpath = str(raw.get("config_relpath") or "").strip()
    return {
        "name": name,
        "aliases": [
            str(alias)
            for alias in (raw.get("aliases") or [])
            if str(alias).strip()
        ],
        "modelType": str(raw.get("model_type") or architecture),
        "architecture": architecture,
        "supported": bool(raw.get("supported")),
        "unsupportedReason": str(raw.get("unsupported_reason") or ""),
        "relpath": relpath,
        "configRelpath": config_relpath,
        "auxiliaryRelpaths": [
            str(path) for path in (raw.get("auxiliary_relpaths") or [])
        ],
        "sizeBytes": int(raw.get("size_bytes") or 0),
        "primaryCategory": primary,
        "primaryCategoryCn": str(raw.get("primary_category_cn") or "").strip(),
        "secondaryCategory": secondary,
        "secondaryCategoryCn": str(raw.get("secondary_category_cn") or "").strip(),
        "categoryPath": "/".join(part for part in (primary, secondary) if part),
        "targetStem": str(raw.get("target_stem") or "").strip(),
        # downloaded / config 每次读取，避免缓存掩盖新下载的模型
        "downloaded": False,
        "config": None,
        "paramCapabilities": _param_capabilities(architecture),
    }


def is_model_downloaded(model: dict[str, Any], model_dir: Path) -> bool:
    """Whether the model weights referenced by a catalog entry exist locally."""
    return _is_downloaded(str(model.get("relpath") or ""), model_dir)


def model_config_info(
    model: dict[str, Any], model_dir: Path
) -> dict[str, Any] | None:
    """Read the model YAML (cached models only); ``None`` when not downloaded."""
    return _read_model_config(
        str(model.get("relpath") or ""),
        str(model.get("configRelpath") or ""),
        model_dir,
    )


def default_model_for_models(
    secondary_category: str,
    models: list[dict[str, Any]],
) -> str:
    """Pick the default model for one secondary category."""
    override = DEFAULT_MODEL_OVERRIDES.get(secondary_category)
    if override and any(str(model["name"]) == override for model in models):
        return override
    return str(models[0]["name"]) if models else ""


def _group_categories(models: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group models by primary / secondary category, preserving CN labels."""
    secondary_nodes: dict[tuple[str, str], dict[str, Any]] = {}
    for model in models:
        primary = model["primaryCategory"] or "other"
        secondary = model["secondaryCategory"] or ""
        key = (primary, secondary)
        node = secondary_nodes.get(key)
        if node is None:
            node = {
                "primaryCategory": primary,
                "primaryCategoryCn": model["primaryCategoryCn"] or primary,
                "secondaryCategory": secondary,
                "secondaryCategoryCn": model["secondaryCategoryCn"]
                or secondary
                or "其他",
                "models": [],
            }
            secondary_nodes[key] = node
        node["models"].append(model)

    primary_nodes: dict[str, dict[str, Any]] = {}
    for (primary, _), node in secondary_nodes.items():
        node["models"].sort(key=lambda item: str(item["name"]).lower())
        primary_node = primary_nodes.get(primary)
        if primary_node is None:
            primary_node = {
                "primaryCategory": primary,
                "primaryCategoryCn": node["primaryCategoryCn"],
                "secondaryCategories": [],
            }
            primary_nodes[primary] = primary_node
        primary_node["secondaryCategories"].append(node)

    result = list(primary_nodes.values())
    result.sort(
        key=lambda node: (node["primaryCategoryCn"], node["primaryCategory"])
    )
    for node in result:
        node["secondaryCategories"].sort(
            key=lambda child: (
                child["secondaryCategoryCn"],
                child["secondaryCategory"],
            )
        )
    return result


def build_catalog(model_dir: Path) -> dict[str, Any]:
    """Parse the pymss model catalog into a stable, category-aware snapshot."""
    raw_models = _run_pymss_list_json()
    source = "cli"
    if raw_models is None:
        raw_models = _load_bundled_catalog()
        source = "bundled"
    if raw_models is None:
        snapshot = _load_snapshot(model_dir)
        if snapshot is not None:
            snapshot = dict(snapshot)
            snapshot["source"] = "snapshot"
            return snapshot
        source = "none"
        raw_models = []

    models: list[dict[str, Any]] = []
    for raw in raw_models:
        if not isinstance(raw, dict):
            continue
        entry = _normalize_model(raw, model_dir)
        if entry is not None:
            models.append(entry)
    models.sort(key=lambda item: str(item["name"]).lower())

    catalog = {
        "source": source,
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "modelCount": len(models),
        "models": models,
        "categories": _group_categories(models),
    }
    if source in {"cli", "bundled"}:
        _write_snapshot(model_dir, catalog)
    return catalog


def get_catalog(model_dir: Path) -> dict[str, Any]:
    """Return the parsed catalog, cached for a few minutes."""
    model_dir = Path(model_dir)
    now = time.monotonic()
    cached = _CACHE["catalog"]
    if (
        cached is not None
        and _CACHE["model_dir"] == model_dir
        and now - _CACHE["at"] < _CATALOG_TTL_SECONDS
    ):
        return cached
    catalog = build_catalog(model_dir)
    _CACHE["at"] = now
    _CACHE["model_dir"] = model_dir
    _CACHE["catalog"] = catalog
    return catalog


def models_for_category(
    catalog: dict[str, Any], secondary_category: str
) -> list[dict[str, Any]]:
    """Filter the catalog by a pymss secondary category."""
    return [
        model
        for model in catalog.get("models", [])
        if model.get("secondaryCategory") == secondary_category
    ]
