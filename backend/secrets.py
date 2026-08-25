from __future__ import annotations

import copy
import os
import stat
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from .config import CONFIG_DIR


AGENT_KEY_FILE = CONFIG_DIR / "agent.key"


def _load_or_create_key() -> bytes:
    """Load the Fernet key, creating it with 0600 permissions on first use."""
    if AGENT_KEY_FILE.exists():
        return AGENT_KEY_FILE.read_bytes()
    AGENT_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    key = Fernet.generate_key()
    AGENT_KEY_FILE.write_bytes(key)
    try:
        os.chmod(AGENT_KEY_FILE, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:  # pragma: no cover - Windows 等无 POSIX chmod 的场景
        pass
    return key


def _fernet() -> Fernet:
    return Fernet(_load_or_create_key())


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str) -> str | None:
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeDecodeError):
        return None


def mask_secret(value: str) -> str:
    value = str(value or "").strip()
    if not value:
        return ""
    if len(value) <= 8:
        return "****"
    return f"{value[:3]}****{value[-4:]}"


def resolve_api_key(settings: dict[str, Any]) -> str:
    """Resolve the effective Agent API key.

    Priority: settings (encrypted at rest, plaintext fallback for manual config)
    -> DEEPSEEK_API_KEY / LLM_API_KEY from environment or .env.
    """
    agent = settings.get("agent") or {}
    stored = str(agent.get("api_key") or "").strip()
    if stored:
        decrypted = decrypt_secret(stored)
        if decrypted:
            return decrypted.strip()
        if stored.startswith("sk-") and "****" not in stored:
            # 允许手工写入 settings.json 的明文 Key（开发期兜底）
            return stored.strip()

    provider = str(agent.get("provider") or "deepseek").lower()
    if provider == "deepseek":
        env_key = os.environ.get("DEEPSEEK_API_KEY")
    else:
        env_key = os.environ.get("LLM_API_KEY")
    return (env_key or os.environ.get("LLM_API_KEY") or "").strip()


def normalize_saved_api_key(
    existing_settings: dict[str, Any],
    incoming: Any,
) -> str:
    """Turn an incoming form value into a persisted API key value.

    - 空字符串：清除已保存的 Key；
    - 含 **** 的掩码（或与现有掩码一致）：保留原加密值；
    - 其余：视为新 Key，加密后保存。
    """
    incoming = str(incoming or "").strip()
    existing = str(
        (existing_settings.get("agent") or {}).get("api_key") or ""
    ).strip()
    if not incoming:
        return ""
    if "****" in incoming:
        return existing
    if existing and mask_secret(incoming) == mask_secret(
        resolve_api_key(existing_settings)
    ):
        return existing
    return encrypt_secret(incoming)


def public_settings(settings: dict[str, Any]) -> dict[str, Any]:
    """Return settings safe for the browser: API key is masked, never raw."""
    result = copy.deepcopy(settings)
    agent = result.setdefault("agent", {})
    stored = str(agent.get("api_key") or "").strip()
    raw = resolve_api_key(settings)
    agent["api_key"] = mask_secret(raw)
    agent["api_key_configured"] = bool(raw)
    if raw and stored:
        agent["api_key_source"] = "settings"
    elif raw:
        agent["api_key_source"] = "env"
    else:
        agent["api_key_source"] = "none"
    return result
