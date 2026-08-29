"""Agent turn orchestration: LangGraph ReAct + message persistence."""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from langchain_core.messages import AIMessage, ToolMessage

from .. import db
from .graph import compile_agent_graph
from .prompt import build_initial_messages


_active_turns: dict[str, dict[str, Any]] = {}
_active_turns_lock = threading.Lock()


def get_active_turn(conversation_id: str) -> dict[str, Any] | None:
    """Return the in-memory running-turn marker for one conversation."""
    with _active_turns_lock:
        return _active_turns.get(conversation_id)


def get_active_turn_conversation_ids() -> set[str]:
    with _active_turns_lock:
        return set(_active_turns)


def try_start_turn(conversation_id: str) -> dict[str, Any] | None:
    """Atomically reserve one running turn per conversation; ``None`` if busy."""
    now = datetime.now(timezone.utc).isoformat()
    turn = {
        "conversation_id": conversation_id,
        "turn_id": str(uuid.uuid4()),
        "started_at": now,
    }
    with _active_turns_lock:
        if conversation_id in _active_turns:
            return None
        _active_turns[conversation_id] = turn
    return turn


def _mark_turn_finished(conversation_id: str) -> None:
    with _active_turns_lock:
        _active_turns.pop(conversation_id, None)


def _persist_turn_messages(
    conversation_id: str,
    new_messages: list[Any],
) -> list[dict[str, Any]]:
    tool_results: dict[str, Any] = {}
    for message in new_messages:
        if isinstance(message, ToolMessage):
            try:
                tool_results[message.tool_call_id] = json.loads(
                    message.content or "{}"
                )
            except (TypeError, ValueError):
                tool_results[message.tool_call_id] = {"error": message.content}

    saved: list[dict[str, Any]] = []
    for message in new_messages:
        if isinstance(message, AIMessage):
            now = datetime.now(timezone.utc).isoformat()
            tool_calls = []
            for call in getattr(message, "tool_calls", None) or []:
                call_id = call.get("id") or ""
                tool_calls.append(
                    {
                        "id": call_id,
                        "name": call.get("name") or "",
                        "arguments": call.get("args") or {},
                        "result": tool_results.get(call_id),
                    }
                )
            row = {
                "id": str(getattr(message, "id", None) or uuid.uuid4()),
                "conversation_id": conversation_id,
                "role": "assistant",
                "content": str(message.content or ""),
                "files": [],
                "tool_calls": tool_calls,
                "tool_call_id": None,
                "created_at": now,
                "updated_at": now,
            }
            db.insert_agent_message(row)
            saved.append(row)
    return saved


def run_agent_turn(
    conversation_id: str,
    context: dict[str, Any],
    history: list[dict[str, Any]],
    settings: dict[str, Any],
    emit: Callable[[str, Any], None],
) -> dict[str, Any]:
    """Run one ReAct turn inside LangGraph and persist all produced messages.

    ``emit`` receives model-message events which the SSE layer forwards to the browser.
    """
    messages = build_initial_messages(context, history)
    graph = compile_agent_graph(
        settings=settings,
        context={**context, "conversation_id": conversation_id, "emit": emit},
        emit=emit,
    )
    turn = try_start_turn(conversation_id)
    if turn is None:
        raise RuntimeError("该会话正在处理中，请稍后再发送")
    emit("turn_started", turn)
    try:
        result = graph.invoke(
            {
                "messages": messages,
                "settings": settings,
                "context": {
                    **context,
                    "conversation_id": conversation_id,
                    "emit": emit,
                },
                "rounds": 0,
            }
        )
    finally:
        _mark_turn_finished(conversation_id)
    new_messages = result["messages"][len(messages) :]
    saved = _persist_turn_messages(conversation_id, new_messages)
    db.touch_agent_conversation(conversation_id)
    emit("turn_finished", {"conversation_id": conversation_id})
    if saved:
        return saved[-1]
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "role": "assistant",
        "content": "",
        "files": [],
        "tool_calls": [],
        "tool_call_id": None,
        "created_at": now,
        "updated_at": now,
    }
