from __future__ import annotations

import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import db
from .config import load_settings, resolve_project_path
from .tools.ffmpeg import resolve_output_path
from .workflows.audio import compile_audio_router_graph


TERMINAL_STATUSES = {"completed", "failed", "cancelled"}

TASK_ID_NAMESPACE = uuid.UUID("a30f6e3e-8d5b-4b21-9d4a-2f7c0e9b6d11")

INPUT_PARAM_KEYS = {"inputFile", "audioTrack", "inputFiles"}
OUTPUT_PARAM_KEYS = {
    "outputFormat",
    "outputFileName",
    "bitrate",
    "sampleRate",
    "channels",
    "truePeakMax",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def deterministic_task_id(input_file: str, timestamp: int | str) -> str:
    """Build a UUIDv5 task id bound to the input file and a creation seed timestamp.

    The audio function is intentionally excluded from the key: the same input
    file keeps one deterministic binding, and a fresh timestamp produces a
    fresh task id.
    """
    input_path = resolve_project_path(input_file) or Path(input_file).resolve()
    key = f"{input_path}\n{timestamp}"
    return str(uuid.uuid5(TASK_ID_NAMESPACE, key))


def _task_snapshot(task: dict[str, Any]) -> dict[str, Any]:
    return {
        **task,
        "params": dict(task.get("params", {})),
        "input_params": dict(task.get("input_params", {})),
        "output_params": dict(task.get("output_params", {})),
        "config": dict(task.get("config", {})),
        "logs": list(task.get("logs", [])),
        "outputs": list(task.get("outputs", [])),
        "command": list(task["command"]) if task.get("command") else None,
    }


def _classify_audio_params(
    params: dict[str, Any],
    settings: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Split task params into input / output / config snapshots for auditability."""
    input_params = {
        key: params[key]
        for key in INPUT_PARAM_KEYS
        if key in params and params[key] not in (None, "")
    }
    output_params = {
        key: params[key]
        for key in OUTPUT_PARAM_KEYS
        if key in params and params[key] not in (None, "")
    }
    processing = {
        key: value
        for key, value in params.items()
        if key not in INPUT_PARAM_KEYS
        and key not in OUTPUT_PARAM_KEYS
        and key != "task_type"
    }
    ffmpeg_settings = settings.get("ffmpeg", {})
    task_settings = settings.get("tasks", {})
    config = {
        "processing": processing,
        "runtime": {
            "ffmpeg": {
                "mode": ffmpeg_settings.get("mode"),
                "timeout_seconds": ffmpeg_settings.get("timeout_seconds", 3600),
            },
            "tasks": {"max_workers": task_settings.get("max_workers", 2)},
        },
    }
    return input_params, output_params, config


class TaskManager:
    """In-memory task queue; workflows run in a background thread pool."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._tasks: dict[str, dict[str, Any]] = {}
        self._processes: dict[str, list[Any]] = {}
        self._executor: ThreadPoolExecutor | None = None
        db.init_db()
        self._load_persisted_tasks()

    def _load_persisted_tasks(self) -> None:
        """Load SQLite records; mark stale non-terminal tasks as failed."""
        for task in db.list_tasks():
            self._tasks[task["id"]] = task
            if task["status"] not in TERMINAL_STATUSES:
                task["status"] = "failed"
                task["error"] = "服务重启，任务中断（暂不支持自动恢复）"
                task["updated_at"] = _now()
                db.update_task(
                    task["id"],
                    status=task["status"],
                    error=task["error"],
                    updated_at=task["updated_at"],
                )

    def _ensure_executor(self) -> ThreadPoolExecutor:
        if self._executor is None:
            settings = load_settings()
            max_workers = max(1, int(settings.get("tasks", {}).get("max_workers", 2)))
            self._executor = ThreadPoolExecutor(
                max_workers=max_workers,
                thread_name_prefix="wavebank-task",
            )
        return self._executor

    def create_audio_task(
        self,
        params: dict[str, Any],
        task_type: str = "audio",
        *,
        mode: str = "new",
        task_id: str | None = None,
        timestamp: int | None = None,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        params = dict(params)
        params.setdefault("task_type", task_type)
        input_file = str(params.get("inputFile", ""))
        mode = str(mode or "new").lower()
        if mode not in {"new", "rebuild"}:
            raise ValueError(f"未知的任务创建意图：{mode}")
        if conversation_id and not db.get_agent_conversation(conversation_id):
            raise ValueError(f"会话不存在：{conversation_id}")
        try:
            seed_ts = int(timestamp) if timestamp not in (None, "") else int(time.time() * 1000)
        except (TypeError, ValueError):
            raise ValueError("时间戳参数必须是整数毫秒值")
        if mode == "rebuild":
            if not task_id:
                raise ValueError("重构输出必须提供 task_id")
            expected_id = deterministic_task_id(input_file, seed_ts)
            if task_id != expected_id:
                existing_task = db.get_task(task_id)
                if existing_task:
                    seed = (
                        existing_task.get("config", {})
                        .get("runtime", {})
                        .get("task_seed")
                    )
                    if seed and seed.get("timestamp") is not None:
                        # 新方案任务：必须与存储的 seed 严格一致。
                        legacy_expected = deterministic_task_id(
                            input_file, seed["timestamp"]
                        )
                        if task_id != legacy_expected:
                            raise ValueError(
                                "task_id 与输入文件/时间戳不匹配，无法重构输出"
                            )
                    else:
                        # 旧方案任务（无 seed）：仅校验输入文件一致即可。
                        existing_input = existing_task.get("params", {}).get(
                            "inputFile"
                        ) or existing_task.get("input_params", {}).get("inputFile")
                        resolved_current = (
                            resolve_project_path(input_file) or Path(input_file).resolve()
                        )
                        resolved_existing = (
                            resolve_project_path(str(existing_input))
                            if existing_input
                            else None
                        )
                        if (
                            resolved_existing is None
                            or resolved_existing != resolved_current
                        ):
                            raise ValueError(
                                "task_id 与输入文件/时间戳不匹配，无法重构输出"
                            )
                else:
                    raise ValueError("task_id 与输入文件/时间戳不匹配，无法重构输出")
            used_id = task_id
        else:
            used_id = deterministic_task_id(input_file, seed_ts)

        settings = load_settings()
        task_root = resolve_project_path(settings["paths"].get("tmp_dir", "tmp"))
        if task_root is None:
            task_root = resolve_project_path("tmp")
        assert task_root is not None
        task_dir = task_root / used_id

        input_params, output_params, config = _classify_audio_params(params, settings)
        config.setdefault("runtime", {})["task_seed"] = {"timestamp": seed_ts, "mode": mode}
        with self._lock:
            existing = self._tasks.get(used_id) or db.get_task(used_id)
            if existing and existing["status"] not in TERMINAL_STATUSES:
                raise ValueError("该任务正在处理中，请等待完成或先取消")
            if existing:
                old_dir = existing.get("tmp_dir")
                if old_dir and Path(old_dir).is_dir() and Path(old_dir).name == used_id:
                    shutil.rmtree(old_dir, ignore_errors=True)
                self._tasks.pop(used_id, None)
                self._processes.pop(used_id, None)
                db.delete_task(used_id)

            task_dir.mkdir(parents=True, exist_ok=True)
            target_path = str(resolve_output_path(params, used_id, settings))
            task: dict[str, Any] = {
                "id": used_id,
                "type": task_type,
                "conversation_id": conversation_id,
                "intent": "audio",
                "creation_mode": mode,
                "status": "pending",
                "progress": 0.0,
                "params": dict(params),
                "input_params": input_params,
                "output_params": output_params,
                "config": config,
                "target_path": target_path,
                "command": None,
                "logs": [],
                "outputs": [],
                "error": None,
                "tmp_dir": str(task_dir),
                "created_at": _now(),
                "updated_at": _now(),
            }
            self._tasks[used_id] = task
        db.insert_task(task)
        self._ensure_executor().submit(self._run_audio_task, used_id, dict(params))
        return _task_snapshot(task)

    def _run_audio_task(self, task_id: str, params: dict[str, Any]) -> None:
        process_holder: list[Any] = []
        with self._lock:
            self._processes[task_id] = process_holder
            self._tasks[task_id]["status"] = "running"
            self._tasks[task_id]["updated_at"] = _now()
        db.update_task(task_id, status="running", updated_at=_now())

        try:
            graph = compile_audio_router_graph(
                on_log=lambda line: self.append_log(task_id, line),
                on_progress=lambda percent: self.update_progress(task_id, percent),
                process_holder=process_holder,
            )
            state = graph.invoke({"task_id": task_id, "params": params})
            with self._lock:
                task = self._tasks[task_id]
                task.update(
                    status="completed",
                    progress=100.0,
                    command=state.get("command"),
                    outputs=state.get("outputs", []),
                    target_path=state.get("target_path") or task.get("target_path"),
                    error=None,
                    updated_at=_now(),
                )
                db.update_task(
                    task_id,
                    status=task["status"],
                    progress=task["progress"],
                    command=task["command"],
                    outputs=task["outputs"],
                    target_path=task["target_path"],
                    error=task["error"],
                    updated_at=task["updated_at"],
                )
        except Exception as exc:  # noqa: BLE001 - 失败信息要写入任务记录
            with self._lock:
                task = self._tasks[task_id]
                if task.get("status") == "cancelling":
                    task.update(status="cancelled", error="任务已取消", updated_at=_now())
                else:
                    task.update(
                        status="failed",
                        error=str(exc),
                        updated_at=_now(),
                    )
                db.update_task(
                    task_id,
                    status=task["status"],
                    error=task["error"],
                    updated_at=task["updated_at"],
                )
        finally:
            with self._lock:
                self._processes.pop(task_id, None)

    def append_log(self, task_id: str, line: str) -> None:
        with self._lock:
            task = self._tasks.get(task_id)
            if task:
                task["logs"].append(line)
                if len(task["logs"]) > 2000:
                    task["logs"] = task["logs"][-2000:]
                task["updated_at"] = _now()
                db.update_task(task_id, logs=task["logs"], updated_at=task["updated_at"])

    def update_progress(self, task_id: str, percent: float) -> None:
        with self._lock:
            task = self._tasks.get(task_id)
            if task:
                task["progress"] = round(max(0.0, min(100.0, percent)), 1)
                db.update_task(task_id, progress=task["progress"])

    def cancel_task(self, task_id: str) -> dict[str, Any]:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                raise KeyError(task_id)
            if task["status"] not in TERMINAL_STATUSES:
                task["status"] = "cancelling"
                task["updated_at"] = _now()
                for process in self._processes.get(task_id, []):
                    if process and process.poll() is None:
                        process.terminate()
                db.update_task(task_id, status=task["status"], updated_at=task["updated_at"])
            return _task_snapshot(task)

    def get_task(self, task_id: str) -> dict[str, Any]:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                task = db.get_task(task_id)
                if not task:
                    raise KeyError(task_id)
                self._tasks[task_id] = task
            return _task_snapshot(task)

    def list_tasks(self) -> list[dict[str, Any]]:
        with self._lock:
            tasks = [_task_snapshot(task) for task in self._tasks.values()]
        tasks.sort(key=lambda item: item["created_at"], reverse=True)
        return tasks

    def add_task_message(
        self,
        task_id: str,
        role: str,
        content: str = "",
        *,
        files: list[dict[str, Any]] | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        self.get_task(task_id)
        now = _now()
        message = {
            "id": str(uuid.uuid4()),
            "task_id": task_id,
            "role": role,
            "content": content,
            "files": files or [],
            "tool_calls": tool_calls or [],
            "created_at": now,
            "updated_at": now,
        }
        db.insert_task_message(message)
        return message

    def list_task_messages(self, task_id: str) -> list[dict[str, Any]]:
        self.get_task(task_id)
        return db.list_task_messages(task_id)

    def delete_task(self, task_id: str) -> None:
        """Delete a finished task record, its messages and task directory."""
        try:
            uuid.UUID(task_id)
        except ValueError as exc:
            raise ValueError(f"非法任务 ID：{task_id}") from exc

        with self._lock:
            task = self._tasks.get(task_id) or db.get_task(task_id)
            if not task:
                raise KeyError(task_id)
            if task["status"] not in TERMINAL_STATUSES:
                raise ValueError("只能删除已结束的任务（完成/失败/已取消），请先取消")

            task_dir = task.get("tmp_dir")
            if task_dir:
                path = Path(task_dir)
                if path.is_dir() and path.name == task_id:
                    shutil.rmtree(path, ignore_errors=True)

            self._tasks.pop(task_id, None)
            self._processes.pop(task_id, None)
            db.delete_task(task_id)


task_manager = TaskManager()
