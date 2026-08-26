from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import PROJECT_ROOT, load_settings, resolve_project_path


_db_lock = threading.RLock()


def get_db_path() -> Path:
    settings = load_settings()
    data_dir = resolve_project_path(settings["paths"].get("data_dir", "backend/data"))
    if data_dir is None:
        data_dir = PROJECT_ROOT / "backend" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "tasks.db"


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(get_db_path(), timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    return connection


def init_db() -> None:
    with _db_lock, closing(_connect()) as connection:
        with connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    conversation_id TEXT,
                    status TEXT NOT NULL,
                    progress REAL NOT NULL DEFAULT 0,
                    intent TEXT,
                    creation_mode TEXT NOT NULL DEFAULT 'new',
                    params TEXT NOT NULL DEFAULT '{}',
                    input_params TEXT NOT NULL DEFAULT '{}',
                    output_params TEXT NOT NULL DEFAULT '{}',
                    config TEXT NOT NULL DEFAULT '{}',
                    target_path TEXT,
                    command TEXT,
                    logs TEXT NOT NULL DEFAULT '[]',
                    outputs TEXT NOT NULL DEFAULT '[]',
                    tmp_dir TEXT,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            _migrate_task_columns(connection)
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON tasks(conversation_id)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS task_messages (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    files TEXT NOT NULL DEFAULT '[]',
                    tool_calls TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_task_messages_task_created "
                "ON task_messages(task_id, created_at)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_conversations (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    files TEXT NOT NULL DEFAULT '[]',
                    tool_calls TEXT NOT NULL DEFAULT '[]',
                    tool_call_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            _migrate_agent_message_columns(connection)
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_agent_messages_conv_created "
                "ON agent_messages(conversation_id, created_at)"
            )


def _migrate_agent_message_columns(connection: sqlite3.Connection) -> None:
    """Add newer agent-message columns to an existing database without data loss."""
    existing = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(agent_messages)").fetchall()
    }
    additions = {
        "tool_calls": "TEXT NOT NULL DEFAULT '[]'",
        "tool_call_id": "TEXT",
    }
    for name, definition in additions.items():
        if name not in existing:
            connection.execute(
                f"ALTER TABLE agent_messages ADD COLUMN {name} {definition}"
            )


def _migrate_task_columns(connection: sqlite3.Connection) -> None:
    """Add newer task columns to an existing database without dropping data."""
    existing = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(tasks)").fetchall()
    }
    additions = {
        "intent": "TEXT",
        "creation_mode": "TEXT NOT NULL DEFAULT 'new'",
        "input_params": "TEXT NOT NULL DEFAULT '{}'",
        "output_params": "TEXT NOT NULL DEFAULT '{}'",
        "config": "TEXT NOT NULL DEFAULT '{}'",
        "target_path": "TEXT",
        "conversation_id": "TEXT",
    }
    for name, definition in additions.items():
        if name not in existing:
            connection.execute(f"ALTER TABLE tasks ADD COLUMN {name} {definition}")


def _serialize(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return value


def _row_to_task(row: sqlite3.Row) -> dict[str, Any]:
    def _field(name: str, default: Any = None) -> Any:
        return row[name] if name in row.keys() else default

    return {
        "id": _field("id"),
        "type": _field("type"),
        "status": _field("status"),
        "progress": _field("progress", 0.0),
        "intent": _field("intent"),
        "creation_mode": _field("creation_mode", "new"),
        "conversation_id": _field("conversation_id"),
        "params": json.loads(_field("params", "{}") or "{}"),
        "input_params": json.loads(_field("input_params", "{}") or "{}"),
        "output_params": json.loads(_field("output_params", "{}") or "{}"),
        "config": json.loads(_field("config", "{}") or "{}"),
        "target_path": _field("target_path"),
        "command": json.loads(_field("command")) if _field("command") else None,
        "logs": json.loads(_field("logs", "[]") or "[]"),
        "outputs": json.loads(_field("outputs", "[]") or "[]"),
        "tmp_dir": _field("tmp_dir"),
        "error": _field("error"),
        "created_at": _field("created_at"),
        "updated_at": _field("updated_at"),
    }


def insert_task(task: dict[str, Any]) -> None:
    with _db_lock, closing(_connect()) as connection:
        with connection:
            connection.execute(
                """
                INSERT INTO tasks (
                    id, type, conversation_id, status, progress, intent, creation_mode,
                    params, input_params, output_params, config, target_path, command,
                    logs, outputs, tmp_dir, error, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task["id"],
                    task["type"],
                    task.get("conversation_id"),
                    task["status"],
                    task["progress"],
                    task.get("intent"),
                    task.get("creation_mode", "new"),
                    _serialize(task.get("params", {})),
                    _serialize(task.get("input_params", {})),
                    _serialize(task.get("output_params", {})),
                    _serialize(task.get("config", {})),
                    task.get("target_path"),
                    _serialize(task.get("command")),
                    _serialize(task.get("logs", [])),
                    _serialize(task.get("outputs", [])),
                    task.get("tmp_dir"),
                    task.get("error"),
                    task["created_at"],
                    task["updated_at"],
                ),
            )


UPDATE_FIELDS = {
    "status",
    "progress",
    "intent",
    "creation_mode",
    "params",
    "input_params",
    "output_params",
    "config",
    "target_path",
    "command",
    "logs",
    "outputs",
    "tmp_dir",
    "error",
    "updated_at",
}


def update_task(task_id: str, **fields: Any) -> None:
    unknown = set(fields) - UPDATE_FIELDS
    if unknown:
        raise ValueError(f"不允许更新的任务字段：{sorted(unknown)}")
    if not fields:
        return
    assignments = ", ".join(f"{name}=?" for name in fields)
    values = [_serialize(fields[name]) for name in fields]
    values.append(task_id)
    with _db_lock, closing(_connect()) as connection:
        with connection:
            connection.execute(f"UPDATE tasks SET {assignments} WHERE id=?", values)


def get_task(task_id: str) -> dict[str, Any] | None:
    with _db_lock, closing(_connect()) as connection:
        row = connection.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    return _row_to_task(row) if row else None


def list_tasks() -> list[dict[str, Any]]:
    with _db_lock, closing(_connect()) as connection:
        rows = connection.execute("SELECT * FROM tasks ORDER BY created_at DESC").fetchall()
    return [_row_to_task(row) for row in rows]


def insert_task_message(message: dict[str, Any]) -> None:
    with _db_lock, closing(_connect()) as connection:
        with connection:
            connection.execute(
                """
                INSERT INTO task_messages (
                    id, task_id, role, content, files, tool_calls,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    message["id"],
                    message["task_id"],
                    message["role"],
                    message.get("content", ""),
                    _serialize(message.get("files", [])),
                    _serialize(message.get("tool_calls", [])),
                    message["created_at"],
                    message["updated_at"],
                ),
            )


def list_task_messages(task_id: str) -> list[dict[str, Any]]:
    with _db_lock, closing(_connect()) as connection:
        rows = connection.execute(
            "SELECT * FROM task_messages WHERE task_id=? ORDER BY created_at ASC",
            (task_id,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "task_id": row["task_id"],
            "role": row["role"],
            "content": row["content"],
            "files": json.loads(row["files"] or "[]"),
            "tool_calls": json.loads(row["tool_calls"] or "[]"),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        for row in rows
    ]


def delete_task(task_id: str) -> None:
    """Remove a task and its associated agent messages from SQLite."""
    with _db_lock, closing(_connect()) as connection:
        with connection:
            connection.execute("DELETE FROM task_messages WHERE task_id=?", (task_id,))
            connection.execute("DELETE FROM tasks WHERE id=?", (task_id,))


def _agent_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def insert_agent_conversation(conversation_id: str) -> None:
    """Create an agent conversation record if it does not exist yet."""
    now = _agent_now()
    with _db_lock, closing(_connect()) as connection:
        with connection:
            connection.execute(
                "INSERT OR IGNORE INTO agent_conversations (id, created_at, updated_at) "
                "VALUES (?, ?, ?)",
                (conversation_id, now, now),
            )


def get_agent_conversation(conversation_id: str) -> dict[str, Any] | None:
    with _db_lock, closing(_connect()) as connection:
        row = connection.execute(
            "SELECT * FROM agent_conversations WHERE id=?",
            (conversation_id,),
        ).fetchone()
    return dict(row) if row else None


def list_agent_conversations() -> list[dict[str, Any]]:
    """List agent conversations, newest activity first, with message counts."""
    with _db_lock, closing(_connect()) as connection:
        rows = connection.execute(
            """
            SELECT
                c.id,
                c.created_at,
                c.updated_at,
                COUNT(m.id) AS message_count,
                (
                    SELECT content FROM agent_messages
                    WHERE conversation_id = c.id
                    ORDER BY created_at DESC
                    LIMIT 1
                ) AS last_message
            FROM agent_conversations c
            LEFT JOIN agent_messages m ON m.conversation_id = c.id
            GROUP BY c.id
            ORDER BY c.updated_at DESC, c.created_at DESC
            """
        ).fetchall()
    return [
        {
            "id": row["id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "message_count": row["message_count"],
            "last_message": row["last_message"],
        }
        for row in rows
    ]


def touch_agent_conversation(conversation_id: str) -> None:
    with _db_lock, closing(_connect()) as connection:
        with connection:
            connection.execute(
                "UPDATE agent_conversations SET updated_at=? WHERE id=?",
                (_agent_now(), conversation_id),
            )


def insert_agent_message(message: dict[str, Any]) -> None:
    with _db_lock, closing(_connect()) as connection:
        with connection:
            connection.execute(
                """
                INSERT INTO agent_messages (
                    id, conversation_id, role, content, files, tool_calls,
                    tool_call_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    message["id"],
                    message["conversation_id"],
                    message["role"],
                    message.get("content", ""),
                    _serialize(message.get("files", [])),
                    _serialize(message.get("tool_calls", [])),
                    message.get("tool_call_id"),
                    message["created_at"],
                    message["updated_at"],
                ),
            )


def list_agent_messages(conversation_id: str) -> list[dict[str, Any]]:
    with _db_lock, closing(_connect()) as connection:
        rows = connection.execute(
            "SELECT * FROM agent_messages WHERE conversation_id=? ORDER BY created_at ASC",
            (conversation_id,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "conversation_id": row["conversation_id"],
            "role": row["role"],
            "content": row["content"],
            "files": json.loads(row["files"] or "[]"),
            "tool_calls": (
                json.loads(row["tool_calls"] or "[]")
                if "tool_calls" in row.keys()
                else []
            ),
            "tool_call_id": (
                row["tool_call_id"] if "tool_call_id" in row.keys() else None
            ),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        for row in rows
    ]


def _collect_task_ids(value: Any) -> set[str]:
    task_ids: set[str] = set()
    if isinstance(value, dict):
        task_id = value.get("task_id")
        if isinstance(task_id, str) and task_id.strip():
            task_ids.add(task_id.strip())
        for item in value.values():
            task_ids.update(_collect_task_ids(item))
    elif isinstance(value, list):
        for item in value:
            task_ids.update(_collect_task_ids(item))
    return task_ids


def rollback_agent_conversation(
    conversation_id: str,
    message_id: str,
) -> dict[str, Any]:
    deleted_task_ids: set[str] = set()
    with _db_lock, closing(_connect()) as connection:
        with connection:
            target = connection.execute(
                """
                SELECT rowid, role FROM agent_messages
                WHERE conversation_id=? AND id=?
                """,
                (conversation_id, message_id),
            ).fetchone()
            if not target:
                raise KeyError(message_id)
            if target["role"] != "user":
                raise ValueError("只能回溯到用户消息")
            rows_to_delete = connection.execute(
                """
                SELECT tool_calls FROM agent_messages
                WHERE conversation_id=? AND rowid>=?
                """,
                (conversation_id, target["rowid"]),
            ).fetchall()
            for row in rows_to_delete:
                try:
                    deleted_task_ids.update(
                        _collect_task_ids(json.loads(row["tool_calls"] or "[]"))
                    )
                except json.JSONDecodeError:
                    continue
            connection.execute(
                """
                DELETE FROM agent_messages
                WHERE conversation_id=? AND rowid>=?
                """,
                (conversation_id, target["rowid"]),
            )
            connection.execute(
                "UPDATE agent_conversations SET updated_at=? WHERE id=?",
                (_agent_now(), conversation_id),
            )
    return {
        "messages": list_agent_messages(conversation_id),
        "deleted_task_ids": sorted(deleted_task_ids),
    }


def delete_agent_conversation(conversation_id: str) -> None:
    with _db_lock, closing(_connect()) as connection:
        with connection:
            connection.execute(
                "DELETE FROM agent_messages WHERE conversation_id=?",
                (conversation_id,),
            )
            connection.execute(
                "DELETE FROM agent_conversations WHERE id=?",
                (conversation_id,),
            )
