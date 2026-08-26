"""Low-level OpenAI-compatible LLM wrapper.

Keeps the SDK surface in one place so the LangGraph nodes only deal with
message lists and tool schemas. Supports streaming text deltas and
streaming ``tool_calls`` accumulation (OpenAI-compatible function calling).
"""

from __future__ import annotations

import json
from typing import Any, Callable

from openai import OpenAI

from ..secrets import resolve_api_key


def _client(settings: dict[str, Any]) -> OpenAI:
    agent = settings.get("agent") or {}
    api_key = resolve_api_key(settings)
    if not api_key:
        raise RuntimeError("尚未配置 Agent API Key，请先在设置页的 Agent 配置中填写")
    base_url = str(agent.get("base_url") or "").strip().rstrip("/")
    if not base_url:
        raise RuntimeError("尚未配置 Agent 接口地址，请先在设置页填写 base_url")
    return OpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=float(agent.get("timeout_seconds") or 120),
    )


def _completion_kwargs(
    settings: dict[str, Any],
    messages: list[dict[str, Any]],
    *,
    stream: bool,
    max_tokens: int | None = None,
    tools: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    agent = settings.get("agent") or {}
    model = str(agent.get("model") or "").strip()
    if not model:
        raise RuntimeError("尚未选择 Agent 默认模型，请先在设置页保存模型")
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": stream,
    }
    if max_tokens:
        kwargs["max_tokens"] = max_tokens
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"

    reasoning_effort = str(agent.get("reasoning_effort") or "").strip()
    if reasoning_effort:
        kwargs["reasoning_effort"] = reasoning_effort

    extra_body: dict[str, Any] = {}
    if agent.get("thinking", True):
        extra_body["thinking"] = {"type": "enabled"}
    if extra_body:
        kwargs["extra_body"] = extra_body
    return kwargs


def _create(settings: dict[str, Any], kwargs: dict[str, Any]) -> Any:
    try:
        return _client(settings).chat.completions.create(**kwargs)
    except TypeError:
        reasoning_effort = kwargs.pop("reasoning_effort", None)
        if reasoning_effort:
            extra_body = dict(kwargs.get("extra_body") or {})
            extra_body["reasoning_effort"] = reasoning_effort
            kwargs["extra_body"] = extra_body
        return _client(settings).chat.completions.create(**kwargs)


def _to_openai_messages(messages: list[Any]) -> list[dict[str, Any]]:
    """Convert LangChain message objects into OpenAI chat-completion dicts."""
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

    out: list[dict[str, Any]] = []
    for message in messages:
        if isinstance(message, SystemMessage):
            out.append({"role": "system", "content": str(message.content or "")})
        elif isinstance(message, HumanMessage):
            out.append({"role": "user", "content": str(message.content or "")})
        elif isinstance(message, AIMessage):
            item: dict[str, Any] = {
                "role": "assistant",
                "content": str(message.content or ""),
            }
            tool_calls = getattr(message, "tool_calls", None) or []
            if tool_calls:
                item["tool_calls"] = [
                    {
                        "id": call.get("id") or "",
                        "type": "function",
                        "function": {
                            "name": call.get("name") or "",
                            "arguments": (
                                json.dumps(call.get("args") or {}, ensure_ascii=False)
                                if isinstance(call.get("args"), dict)
                                else str(call.get("args") or "")
                            ),
                        },
                    }
                    for call in tool_calls
                ]
            out.append(item)
        elif isinstance(message, ToolMessage):
            out.append(
                {
                    "role": "tool",
                    "tool_call_id": getattr(message, "tool_call_id", "") or "",
                    "content": str(message.content or ""),
                }
            )
    return out


def stream_chat_completion(
    settings: dict[str, Any],
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None = None,
    on_delta: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Stream a completion, returning ``{content, tool_calls}``.

    ``tool_calls`` is accumulated from OpenAI-compatible streaming deltas and
    returned as an ordered list of ``{"id", "name", "arguments"}`` dicts.
    """
    kwargs = _completion_kwargs(
        settings, messages, stream=True, tools=tools
    )
    stream = _create(settings, kwargs)
    content_parts: list[str] = []
    tool_calls: dict[int, dict[str, str]] = {}
    for chunk in stream:
        if not getattr(chunk, "choices", None):
            continue
        delta = chunk.choices[0].delta
        content = getattr(delta, "content", None)
        if content:
            content_parts.append(content)
            if on_delta:
                on_delta(content)
        delta_tool_calls = getattr(delta, "tool_calls", None)
        if delta_tool_calls:
            for call in delta_tool_calls:
                index = int(getattr(call, "index", 0))
                slot = tool_calls.setdefault(
                    index, {"id": "", "name": "", "arguments": ""}
                )
                call_id = getattr(call, "id", None)
                if call_id:
                    slot["id"] += call_id
                function = getattr(call, "function", None)
                if function:
                    name = getattr(function, "name", None)
                    if name:
                        slot["name"] += name
                    arguments = getattr(function, "arguments", None)
                    if arguments:
                        slot["arguments"] += arguments
    return {
        "content": "".join(content_parts),
        "tool_calls": [
            tool_calls[index] for index in sorted(tool_calls)
        ],
    }


def chat_completion(
    settings: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    max_tokens: int = 64,
) -> str:
    kwargs = _completion_kwargs(settings, messages, stream=False, max_tokens=max_tokens)
    response = _create(settings, kwargs)
    if not getattr(response, "choices", None):
        return ""
    return str(response.choices[0].message.content or "").strip()


def list_models(settings: dict[str, Any]) -> list[dict[str, str]]:
    """List models exposed by the configured OpenAI-compatible /models endpoint."""
    data = _client(settings).models.list()
    return [
        {
            "id": str(item.id),
            "owned_by": str(getattr(item, "owned_by", "") or ""),
        }
        for item in getattr(data, "data", [])
    ]
