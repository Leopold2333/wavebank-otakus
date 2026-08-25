from __future__ import annotations

from pathlib import Path
from typing import Any


def browse_local_files(path: str | None = None) -> dict[str, Any]:
    """List a local directory on the backend host (same machine in local mode)."""
    try:
        if path:
            target = Path(path).expanduser()
        else:
            target = Path.home()
        if not target.is_absolute():
            target = target.resolve()
        target = target.resolve()
    except (OSError, ValueError) as exc:
        raise ValueError(f"无法解析路径：{exc}") from exc

    if not target.exists():
        raise ValueError(f"路径不存在：{target}")
    if target.is_file():
        stat = target.stat()
        return {
            "path": str(target),
            "parent": str(target.parent),
            "is_file": True,
            "entries": [
                {
                    "name": target.name,
                    "path": str(target),
                    "type": "file",
                    "size": stat.st_size,
                    "modified": int(stat.st_mtime * 1000),
                }
            ],
        }

    entries: list[dict[str, Any]] = []
    try:
        children = sorted(target.iterdir(), key=lambda item: (item.is_file(), item.name.lower()))
    except PermissionError as exc:
        raise ValueError(f"没有权限读取目录：{target}") from exc

    for child in children[:500]:
        try:
            stat = child.stat()
            entries.append(
                {
                    "name": child.name,
                    "path": str(child),
                    "type": "dir" if child.is_dir() else "file",
                    "size": stat.st_size if child.is_file() else None,
                    "modified": int(stat.st_mtime * 1000),
                }
            )
        except OSError:
            continue

    return {
        "path": str(target),
        "parent": str(target.parent) if str(target.parent) != str(target) else None,
        "is_file": False,
        "entries": entries,
    }
