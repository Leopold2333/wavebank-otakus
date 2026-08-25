"""LangGraph ReAct loop for the Agent workbench.

Graph layout::

    START -> agent -> tools -> agent -> ... -> END
                 ^                    |
                 |__ (tool_calls) ____|

The ``agent`` node streams the model response and forwards text deltas through
an ``emit`` callback; the ``tools`` node executes every requested tool from the
registry and feeds ``ToolMessage`` results back into the conversation state.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Callable, TypedDict

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from .llm import _to_openai_messages, stream_chat_completion
from .tools import dispatch_tool, get_tool_schemas


MAX_TOOL_ROUNDS = 8


class AgentState(TypedDict, total=False):
    messages: Annotated[list[Any], add_messages]
    settings: dict[str, Any]
    context: dict[str, Any]
    rounds: int


def compile_agent_graph(
    *,
    settings: dict[str, Any],
    context: dict[str, Any],
    emit: Callable[[str, Any], None],
):
    """Build the ReAct graph; ``emit`` receives ("delta"|"tool_call", payload)."""

    def call_model(state: AgentState) -> dict[str, Any]:
        messages = _to_openai_messages(state["messages"])
        result = stream_chat_completion(
            settings,
            messages,
            tools=get_tool_schemas(),
            on_delta=lambda text: emit("delta", text),
        )
        tool_calls: list[dict[str, Any]] = []
        for raw_call in result["tool_calls"]:
            try:
                arguments = json.loads(raw_call.get("arguments") or "{}")
            except (TypeError, ValueError):
                arguments = {}
            tool_calls.append(
                {
                    "id": raw_call.get("id") or "",
                    "name": raw_call.get("name") or "",
                    "args": arguments,
                    "type": "function",
                }
            )
        return {
            "messages": [AIMessage(content=result["content"], tool_calls=tool_calls)],
            "rounds": state.get("rounds", 0) + 1,
        }

    def call_tools(state: AgentState) -> dict[str, Any]:
        last_message = state["messages"][-1]
        tool_messages: list[ToolMessage] = []
        for call in getattr(last_message, "tool_calls", None) or []:
            name = call.get("name") or ""
            arguments = call.get("args") or {}
            try:
                result = dispatch_tool(name, arguments, context)
            except Exception as exc:  # noqa: BLE001 - 错误要回传给模型继续决策
                result = {"error": str(exc)}
            emit(
                "tool_call",
                {
                    "id": call.get("id"),
                    "name": name,
                    "arguments": arguments,
                    "result": result,
                },
            )
            tool_messages.append(
                ToolMessage(
                    content=json.dumps(result, ensure_ascii=False),
                    tool_call_id=call.get("id") or "",
                )
            )
        return {"messages": tool_messages}

    def route_after_model(state: AgentState) -> str:
        last_message = state["messages"][-1]
        has_tools = bool(getattr(last_message, "tool_calls", None))
        if has_tools and state.get("rounds", 0) < MAX_TOOL_ROUNDS:
            return "tools"
        return END

    builder = StateGraph(AgentState)
    builder.add_node("agent", call_model)
    builder.add_node("tools", call_tools)
    builder.add_edge(START, "agent")
    builder.add_edge("tools", "agent")
    builder.add_conditional_edges(
        "agent",
        route_after_model,
        {"tools": "tools", END: END},
    )
    return builder.compile()
