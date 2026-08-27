from __future__ import annotations

import json
import os
import platform
import queue
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, request, send_file

from . import db
from .agent.chat import run_agent_turn
from .agent.llm import chat_completion, list_models
from .config import (
    CONFIG_DIR,
    deep_merge,
    get_settings_path,
    load_settings,
    resolve_project_path,
    save_settings,
)
from .ffmpeg.setup import ensure_prebuilt_runtime
from .msst import describe_msst_runtime
from .schemas import SCHEMAS
from .secrets import (
    normalize_saved_api_key,
    public_settings,
    resolve_api_key,
    resolve_saved_api_key,
)
from .tasks import TERMINAL_STATUSES, task_manager
from .tools.ffmpeg import get_ffmpeg_info, probe_audio_details
from .tools.files import browse_local_files


def create_app() -> Flask:
    app = Flask(__name__)
    app.json.ensure_ascii = False
    app.config["MAX_CONTENT_LENGTH"] = 4 * 1024**3

    @app.get("/api/health")
    def health():
        settings = load_settings()
        ffmpeg = get_ffmpeg_info(settings)
        return jsonify(
            {
                "status": "ok" if ffmpeg["ok"] else "degraded",
                "service": "wavebank-otakus-backend",
                "platform": {
                    "system": platform.system(),
                    "machine": platform.machine(),
                    "python": platform.python_version(),
                },
                "config_dir": str(CONFIG_DIR),
                "settings_path": str(get_settings_path()),
                "ffmpeg": ffmpeg,
            }
        )

    @app.get("/api/settings")
    def get_settings():
        settings = load_settings()
        ffmpeg = get_ffmpeg_info(settings)
        return jsonify(
            {
                "settings": public_settings(settings),
                "config_dir": str(CONFIG_DIR),
                "settings_path": str(get_settings_path()),
                "ffmpeg": ffmpeg,
            }
        )

    @app.post("/api/settings")
    def post_settings():
        payload = request.get_json(silent=True) or {}
        payload = dict(payload)

        existing = load_settings()
        if isinstance(payload.get("agent"), dict):
            agent_patch = dict(payload["agent"])
            if "api_key" in agent_patch:
                normalized_key = normalize_saved_api_key(
                    existing, agent_patch["api_key"]
                )
                agent_patch["api_key"] = normalized_key or None
            payload["agent"] = agent_patch

        saved = save_settings(payload)
        ffmpeg = get_ffmpeg_info(saved)
        return jsonify(
            {
                "settings": public_settings(saved),
                "settings_path": str(get_settings_path()),
                "ffmpeg": ffmpeg,
            }
        )

    @app.post("/api/settings/ffmpeg/executable-path")
    def post_ffmpeg_executable_path():
        payload = request.get_json(silent=True) or {}
        raw_path = str(payload.get("executable_path") or "").strip()

        executable_path = ""
        if raw_path:
            candidate_path = Path(raw_path).expanduser()
            if not candidate_path.is_absolute():
                return jsonify({"error": "ffmpeg 路径必须是绝对路径"}), 400
            if not candidate_path.is_file():
                return jsonify({"error": f"ffmpeg 文件不存在：{candidate_path}"}), 400
            executable_path = str(candidate_path.resolve())

            candidate_settings = deep_merge(
                load_settings(),
                {"ffmpeg": {"executable_path": executable_path}},
            )
            ffmpeg_info = get_ffmpeg_info(candidate_settings)
            if not ffmpeg_info["ok"]:
                return jsonify({"error": ffmpeg_info.get("error")}), 400

        saved = save_settings({"ffmpeg": {"executable_path": executable_path}})
        ffmpeg = get_ffmpeg_info(saved)
        return jsonify(
            {
                "settings": public_settings(saved),
                "settings_path": str(get_settings_path()),
                "ffmpeg": ffmpeg,
            }
        )

    @app.post("/api/agents/chat")
    def agent_chat():
        payload = request.get_json(silent=True) or {}
        settings = load_settings()
        if not resolve_api_key(settings):
            return (
                jsonify(
                    {
                        "error": "尚未配置 Agent API Key，请先在设置页的 Agent 配置中填写"
                    }
                ),
                400,
            )

        content = str(payload.get("content") or "").strip()
        if not content:
            return jsonify({"error": "消息内容不能为空"}), 400

        conversation_id = payload.get("conversation_id")
        if conversation_id:
            if not db.get_agent_conversation(conversation_id):
                return jsonify({"error": f"会话不存在：{conversation_id}"}), 404
        else:
            conversation_id = str(uuid.uuid4())
            db.insert_agent_conversation(conversation_id)

        now = datetime.now(timezone.utc).isoformat()
        user_message = {
            "id": str(uuid.uuid4()),
            "conversation_id": conversation_id,
            "role": "user",
            "content": content,
            "files": payload.get("files") or [],
            "created_at": now,
            "updated_at": now,
        }
        db.insert_agent_message(user_message)
        history = db.list_agent_messages(conversation_id)
        context = {
            "intent": payload.get("intent"),
            "subtype": payload.get("subtype"),
            "params": payload.get("params") or {},
            "files": payload.get("files") or [],
        }
        agent_overrides: dict[str, Any] = {}
        if payload.get("model"):
            agent_overrides["model"] = str(payload["model"])
        if payload.get("reasoning_effort") is not None:
            agent_overrides["reasoning_effort"] = str(payload["reasoning_effort"])
        if payload.get("thinking") is not None:
            agent_overrides["thinking"] = bool(payload["thinking"])
        call_settings = (
            deep_merge(settings, {"agent": agent_overrides})
            if agent_overrides
            else settings
        )

        def generate():
            meta_payload = {
                "conversation_id": conversation_id,
                "user_message_id": user_message["id"],
            }
            yield (
                "event: agent.meta\n"
                "data: "
                f"{json.dumps(meta_payload, ensure_ascii=False)}\n\n"
            )
            event_queue: queue.Queue[tuple[str, Any] | None] = queue.Queue()

            def emit(event: str, data: Any) -> None:
                event_queue.put((event, data))

            def run() -> None:
                try:
                    final = run_agent_turn(
                        conversation_id,
                        context,
                        history,
                        call_settings,
                        emit,
                    )
                    event_queue.put(("_done", final))
                except Exception as exc:  # noqa: BLE001 - 流式错误要传给前端
                    event_queue.put(("_error", str(exc)))

            threading.Thread(target=run, daemon=True).start()
            while True:
                item = event_queue.get()
                if item is None:
                    break
                event, data = item
                if event == "_done":
                    yield (
                        "event: chat.done\n"
                        f"data: {json.dumps({'message': data}, ensure_ascii=False)}\n\n"
                    )
                    break
                if event == "_error":
                    yield (
                        "event: chat.error\n"
                        f"data: {json.dumps({'error': data}, ensure_ascii=False)}\n\n"
                    )
                    break
                if event == "message_start":
                    yield (
                        "event: chat.message_start\n"
                        f"data: {json.dumps({'message': data}, ensure_ascii=False)}\n\n"
                    )
                elif event == "delta":
                    yield (
                        "event: chat.delta\n"
                        f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
                    )
                elif event == "tool_call":
                    yield (
                        "event: chat.tool_call\n"
                        "data: "
                        f"{json.dumps({'tool_call': data}, ensure_ascii=False)}\n\n"
                    )

        return Response(
            generate(),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/api/agents/conversations/<conversation_id>/messages")
    def agent_conversation_messages(conversation_id: str):
        if not db.get_agent_conversation(conversation_id):
            return jsonify({"error": f"会话不存在：{conversation_id}"}), 404
        return jsonify({"messages": db.list_agent_messages(conversation_id)})

    @app.post("/api/agents/conversations/<conversation_id>/rollback")
    def rollback_agent_conversation(conversation_id: str):
        if not db.get_agent_conversation(conversation_id):
            return jsonify({"error": f"会话不存在：{conversation_id}"}), 404
        payload = request.get_json(silent=True) or {}
        message_id = str(payload.get("message_id") or "").strip()
        if not message_id:
            return jsonify({"error": "缺少 message_id"}), 400
        try:
            rollback = db.rollback_agent_conversation(conversation_id, message_id)
            task_manager.discard_tasks_for_rollback(rollback["deleted_task_ids"])
        except KeyError:
            return jsonify({"error": f"消息不存在：{message_id}"}), 404
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify(rollback)

    @app.get("/api/agents/conversations")
    def list_agent_conversations():
        return jsonify({"conversations": db.list_agent_conversations()})

    @app.delete("/api/agents/conversations/<conversation_id>")
    def delete_agent_conversation(conversation_id: str):
        if not db.get_agent_conversation(conversation_id):
            return jsonify({"error": f"会话不存在：{conversation_id}"}), 404
        db.delete_agent_conversation(conversation_id)
        return jsonify({"ok": True})

    @app.get("/api/agents/access")
    def agent_access():
        settings = load_settings()
        has_saved_api_key = bool(resolve_saved_api_key(settings))
        conversations = db.list_agent_conversations()
        has_conversations = len(conversations) > 0
        allowed = has_saved_api_key or has_conversations
        if has_saved_api_key:
            reason = "api_key"
        elif has_conversations:
            reason = "history"
        else:
            reason = "blocked"
        return jsonify(
            {
                "allowed": allowed,
                "reason": reason,
                "has_saved_api_key": has_saved_api_key,
                "has_conversations": has_conversations,
                "conversation_count": len(conversations),
            }
        )

    @app.get("/api/agents/models")
    def agent_models():
        settings = load_settings()
        agent = settings.get("agent") or {}
        if not resolve_api_key(settings):
            return jsonify(
                {
                    "models": agent.get("models") or [],
                    "base_url": agent.get("base_url"),
                    "default_model": "",
                }
            )
        if not str(agent.get("base_url") or "").strip():
            return jsonify(
                {
                    "models": agent.get("models") or [],
                    "base_url": "",
                    "default_model": "",
                }
            )
        try:
            models = list_models(settings)
            default_model = str(agent.get("model") or "").strip()
            if not default_model and models:
                default_model = str(models[0].get("id") or "").strip()
            agent_update: dict[str, Any] = {"models": models}
            if default_model:
                agent_update["model"] = default_model
            save_settings({"agent": agent_update})
            return jsonify(
                {
                    "models": models,
                    "base_url": agent.get("base_url"),
                    "default_model": default_model,
                }
            )
        except Exception as exc:  # noqa: BLE001 - 前端需要可读错误
            return jsonify(
                {
                    "models": agent.get("models") or [],
                    "base_url": agent.get("base_url"),
                    "default_model": agent.get("model"),
                    "error": f"获取模型列表失败：{exc}",
                }
            )

    @app.post("/api/agents/test")
    def agent_test():
        payload = request.get_json(silent=True) or {}
        existing = load_settings()
        agent_patch = payload.get("agent")
        if isinstance(agent_patch, dict):
            agent_patch = dict(agent_patch)
            if "api_key" in agent_patch:
                agent_patch["api_key"] = normalize_saved_api_key(
                    existing, agent_patch["api_key"]
                )
            candidate = deep_merge(existing, {"agent": agent_patch})
        else:
            candidate = deep_merge(existing, payload)

        if not resolve_api_key(candidate):
            return jsonify({"error": "未配置 API Key，无法测试连接"}), 400

        started = time.monotonic()
        try:
            reply = chat_completion(
                candidate,
                [{"role": "user", "content": "请只回复：OK"}],
                max_tokens=16,
            )
            return jsonify(
                {
                    "ok": True,
                    "reply": reply,
                    "model": (candidate.get("agent") or {}).get("model"),
                    "latency_ms": int((time.monotonic() - started) * 1000),
                }
            )
        except Exception as exc:  # noqa: BLE001 - 前端需要可读错误
            return jsonify({"ok": False, "error": str(exc)}), 400

    @app.post("/api/settings/check-ffmpeg")
    def check_ffmpeg():
        payload = request.get_json(silent=True) or {}
        candidate = deep_merge(load_settings(), payload)
        return jsonify({"ffmpeg": get_ffmpeg_info(candidate)})

    @app.get("/api/msst/models")
    def msst_models():
        return jsonify(describe_msst_runtime())

    @app.get("/api/schemas/<task_type>")
    def get_schema(task_type: str):
        schema = SCHEMAS.get(task_type)
        if not schema:
            return jsonify({"error": f"未知任务类型：{task_type}"}), 404
        return jsonify(schema)

    @app.get("/api/schemas/audio/<subtype>")
    def get_audio_subtype_schema(subtype: str):
        schema = SCHEMAS.get(f"audio.{subtype}")
        if not schema:
            return jsonify({"error": f"未知音频二级功能：{subtype}"}), 404
        return jsonify(schema)

    @app.get("/api/files/browse")
    def files_browse():
        try:
            return jsonify(browse_local_files(request.args.get("path")))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

    @app.get("/api/files/content")
    def file_content():
        path = resolve_project_path(request.args.get("path"))
        if path is None or not path.is_file():
            return jsonify({"error": "文件不存在"}), 404
        return send_file(path, conditional=True)

    @app.get("/api/files/stat")
    def file_stat():
        path = resolve_project_path(request.args.get("path"))
        if path is None or not path.is_file():
            return jsonify({"error": "文件不存在"}), 404
        stat = path.stat()
        return jsonify(
            {
                "path": str(path),
                "name": path.name,
                "size": stat.st_size,
                "mtime": int(stat.st_mtime * 1000),
            }
        )

    @app.get("/api/audio/info")
    def audio_info():
        path = resolve_project_path(request.args.get("path"))
        if path is None or not path.is_file():
            return jsonify({"error": "文件不存在"}), 404
        try:
            return jsonify(probe_audio_details(str(path)))
        except Exception as exc:  # noqa: BLE001 - 前端需要可读错误
            return jsonify({"error": str(exc)}), 400

    @app.post("/api/tasks")
    def create_task():
        payload = request.get_json(silent=True) or {}
        task_type = payload.get("task_type", "audio")
        allowed_task_types = {
            key
            for key in SCHEMAS
            if key == "audio" or key.startswith("audio.")
        }
        if task_type not in allowed_task_types:
            return jsonify({"error": f"暂不支持的任务类型：{task_type}"}), 400

        params = payload.get("params") or payload
        input_path = resolve_project_path(params.get("inputFile"))
        if input_path is None or not input_path.is_file():
            return jsonify({"error": f"输入文件不存在：{params.get('inputFile')}"}), 400

        mode = str(payload.get("mode", "new")).lower()
        if mode not in {"new", "rebuild"}:
            return jsonify({"error": f"未知的任务创建意图：{mode}"}), 400
        try:
            task = task_manager.create_audio_task(
                params,
                task_type=task_type,
                mode=mode,
                task_id=payload.get("task_id"),
                timestamp=payload.get("timestamp"),
                conversation_id=payload.get("conversation_id"),
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify(task), 202

    @app.get("/api/tasks")
    def list_tasks():
        return jsonify({"tasks": task_manager.list_tasks()})

    @app.get("/api/tasks/events")
    def task_events_all():
        def generate():
            yield "retry: 2000\n\n"
            while True:
                tasks = task_manager.list_tasks()
                payload = json.dumps({"tasks": tasks}, ensure_ascii=False)
                yield f"event: tasks.snapshot\ndata: {payload}\n\n"
                time.sleep(0.5)

        return Response(
            generate(),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/api/tasks/<task_id>")
    def get_task(task_id: str):
        try:
            return jsonify(task_manager.get_task(task_id))
        except KeyError:
            return jsonify({"error": f"任务不存在：{task_id}"}), 404

    @app.delete("/api/tasks/<task_id>")
    def delete_task(task_id: str):
        try:
            task_manager.delete_task(task_id)
        except KeyError:
            return jsonify({"error": f"任务不存在：{task_id}"}), 404
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify({"ok": True})

    @app.post("/api/tasks/<task_id>/cancel")
    def cancel_task(task_id: str):
        try:
            return jsonify(task_manager.cancel_task(task_id))
        except KeyError:
            return jsonify({"error": f"任务不存在：{task_id}"}), 404

    @app.get("/api/tasks/<task_id>/messages")
    def get_task_messages(task_id: str):
        try:
            return jsonify({"messages": task_manager.list_task_messages(task_id)})
        except KeyError:
            return jsonify({"error": f"任务不存在：{task_id}"}), 404

    @app.post("/api/tasks/<task_id>/messages")
    def post_task_message(task_id: str):
        payload = request.get_json(silent=True) or {}
        role = payload.get("role")
        if role not in {"user", "assistant", "system", "tool"}:
            return jsonify({"error": "role 必须是 user/assistant/system/tool"}), 400
        try:
            message = task_manager.add_task_message(
                task_id,
                role,
                payload.get("content", ""),
                files=payload.get("files"),
                tool_calls=payload.get("tool_calls"),
            )
        except KeyError:
            return jsonify({"error": f"任务不存在：{task_id}"}), 404
        return jsonify(message), 201

    @app.get("/api/tasks/<task_id>/events")
    def task_events(task_id: str):
        def generate():
            yield "retry: 2000\n\n"
            while True:
                try:
                    task = task_manager.get_task(task_id)
                except KeyError:
                    yield "event: error\ndata: {\"message\": \"任务不存在\"}\n\n"
                    break
                payload = json.dumps(task, ensure_ascii=False)
                yield f"event: task.snapshot\ndata: {payload}\n\n"
                if task["status"] in TERMINAL_STATUSES:
                    break
                time.sleep(0.5)

        return Response(
            generate(),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    def run_ffmpeg_startup_check() -> None:
        settings = load_settings()
        info = get_ffmpeg_info(settings)
        if info["ok"]:
            encoders = info.get("encoders") or []
            app.logger.info(
                "ffmpeg 就绪：%s（来源：%s；编码器：%s）",
                info["ffmpeg"],
                info.get("source"),
                "、".join(encoders) if encoders else "未知",
            )
            try:
                current = load_settings()
                if info.get("source") == "system" and not str(
                    current.get("ffmpeg", {}).get("executable_path") or ""
                ).strip():
                    save_settings(
                        {"ffmpeg": {"executable_path": info["ffmpeg"]}}
                    )
                    app.logger.info("已将系统 ffmpeg 路径写入配置：%s", info["ffmpeg"])
                elif info.get("source") == "bundled":
                    installed = str(
                        current.get("ffmpeg", {}).get(
                            "prebuilt_installed_path"
                        )
                        or ""
                    ).strip()
                    if installed != info["ffmpeg"]:
                        save_settings(
                            {
                                "ffmpeg": {
                                    "prebuilt_installed_path": info["ffmpeg"]
                                }
                            }
                        )
                        app.logger.info(
                            "已将本地 ffmpeg 路径写入配置：%s", info["ffmpeg"]
                        )
            except Exception as exc:  # noqa: BLE001 - 启动时写配置失败不应阻断服务
                app.logger.warning("写入 ffmpeg 路径配置失败：%s", exc)
            return

        if str(settings.get("ffmpeg", {}).get("executable_path") or "").strip():
            app.logger.warning("ffmpeg 不可用：%s", info.get("error"))
            return
        if os.environ.get("WAVEBANK_SKIP_FFMPEG_AUTO_INSTALL") == "1":
            app.logger.warning(
                "ffmpeg 不可用：%s。已按启动参数跳过自动安装。",
                info.get("error"),
            )
            return

        result = ensure_prebuilt_runtime(settings)
        if result["ok"]:
            encoders = result.get("encoders") or []
            app.logger.info(
                "内置 ffmpeg 已就绪%s：%s",
                "（本次自动下载）" if result.get("downloaded") else "",
                result.get("ffmpeg"),
            )
            if encoders:
                app.logger.info("内置 ffmpeg 编码器：%s", "、".join(encoders))
            if result.get("missing_encoders"):
                app.logger.warning(
                    "内置 ffmpeg 缺少编码器：%s",
                    "、".join(result["missing_encoders"]),
                )
        else:
            app.logger.warning(
                "内置 ffmpeg 不可用：%s。可安装系统 ffmpeg 或在设置页指定路径。",
                result.get("error"),
            )

    run_ffmpeg_startup_check()

    return app


app = create_app()
