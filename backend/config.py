from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = PROJECT_ROOT / "config"
DEFAULTS_PATH = CONFIG_DIR / "defaults.json"

try:
    from dotenv import load_dotenv

    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:  # pragma: no cover - dotenv 缺失时仅跳过 .env 加载
    pass


def get_settings_path() -> Path:
    env_path = os.environ.get("WAVEBANK_SETTINGS_PATH")
    if env_path:
        return Path(env_path).expanduser().resolve()
    return CONFIG_DIR / "settings.json"


def load_defaults() -> dict[str, Any]:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    return json.loads(DEFAULTS_PATH.read_text(encoding="utf-8"))


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge override into a copy of base."""
    result = copy.deepcopy(base)
    for key, value in override.items():
        if value is None:
            # 显式 None 表示删除该键（用于清除已保存的配置项）。
            result.pop(key, None)
        elif key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def _diff(settings: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
    """Return only values that differ from defaults (supports nested dicts)."""
    result: dict[str, Any] = {}
    for key, value in settings.items():
        default = defaults.get(key)
        if isinstance(value, dict) and isinstance(default, dict):
            nested = _diff(value, default)
            if nested:
                result[key] = nested
        elif value != default:
            result[key] = copy.deepcopy(value)
    return result


def load_settings() -> dict[str, Any]:
    """Effective settings = defaults.json merged with settings.json."""
    settings = load_defaults()
    settings_path = get_settings_path()
    if settings_path.exists():
        try:
            user_settings = json.loads(settings_path.read_text(encoding="utf-8"))
            settings = deep_merge(settings, user_settings)
        except (OSError, json.JSONDecodeError) as exc:
            # A broken user config should not prevent the app from starting.
            settings["config_warning"] = f"无法读取 {settings_path}：{exc}"
    return settings


def save_settings(settings: dict[str, Any]) -> dict[str, Any]:
    """Persist only overrides; keep defaults.json as the source of truth."""
    defaults = load_defaults()
    overrides = _diff(settings, defaults)

    settings_path = get_settings_path()
    settings_path.parent.mkdir(parents=True, exist_ok=True)

    existing: dict[str, Any] = {}
    if settings_path.exists():
        try:
            existing = json.loads(settings_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing = {}

    merged_overrides = deep_merge(existing, overrides)
    settings_path.write_text(
        json.dumps(merged_overrides, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return load_settings()


def resolve_project_path(value: str | Path | None) -> Path | None:
    """Resolve a path relative to the project root; absolute paths are kept."""
    if value is None or value == "":
        return None
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()
