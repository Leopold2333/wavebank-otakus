"""System prompt and conversation-history assembly for the ReAct agent."""

from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage


def build_system_prompt(context: dict[str, Any]) -> str:
    intent = context.get("intent") or ""
    subtype = context.get("subtype") or ""
    files = context.get("files") or []
    params = context.get("params") or {}
    file_text = "\n".join(f"- {item.get('path')}" for item in files) or "（暂无）"
    params_text = (
        json.dumps(params, ensure_ascii=False, indent=2)
        if params
        else "（暂无）"
    )
    return f"""你是 WaveBank Otakus 的音频处理助手，运行在本机 WebUI 中，采用 ReAct 工作方式。

当前所在功能：{intent or "未指定"}{" / " + str(subtype) if subtype else ""}
用户已关联输入文件：
{file_text}
当前人工参数窗中的参数：
{params_text}

工作原则：
1. 全程使用简体中文回答，语气简洁、专业。
2. 你需要信息时先调用 probe_media 探测文件；确定需求后调用 audio_convert / audio_extract / audio_trim / audio_pitch / audio_denoise 创建后台处理任务；任务创建后可调用 get_task_status 查询状态。
3. 工具由系统执行，执行结果会以 tool 消息返回；你根据结果继续思考，直到可以给用户完整答复。
4. 输入文件路径必须来自用户附件或 probe_media 返回结果，禁止编造路径。
5. 创建任务时参数名必须与工具 JSON Schema 完全一致（outputFormat、volumeGain、loudnessTarget、truePeakMax、sampleRate、bitrate、channels、outputFileName、startTime、duration、pitchSemitones、speed、denoiseStrength 等）。
6. 信息不足时直接向用户提问，不要猜测执行。
7. 不要声称任务已经完成，除非 get_task_status 返回 completed。
"""


def history_to_messages(history: list[dict[str, Any]]) -> list[Any]:
    """Convert persisted agent rows into LangChain messages for model context."""
    messages: list[Any] = []
    for item in history:
        role = item.get("role")
        content = str(item.get("content") or "")
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            tool_calls = item.get("tool_calls") or []
            if tool_calls:
                parsed_calls = []
                for call in tool_calls:
                    call_id = call.get("id")
                    if not call_id:
                        continue
                    raw_args = call.get("arguments")
                    if isinstance(raw_args, dict):
                        args = raw_args
                    else:
                        try:
                            args = json.loads(raw_args or "{}")
                        except (TypeError, ValueError):
                            args = {}
                    parsed_calls.append(
                        {
                            "id": call_id,
                            "name": call.get("name") or "",
                            "args": args,
                            "type": "function",
                        }
                    )
                ai_message = AIMessage(content=content, tool_calls=parsed_calls)
                messages.append(ai_message)
                # 用持久化的结果重建 tool 响应，保证后续轮次的 OpenAI 上下文合法
                for call in tool_calls:
                    call_id = call.get("id")
                    result = call.get("result")
                    if call_id and result is not None:
                        messages.append(
                            ToolMessage(
                                content=(
                                    json.dumps(result, ensure_ascii=False)
                                    if not isinstance(result, str)
                                    else result
                                ),
                                tool_call_id=call_id,
                            )
                        )
            else:
                messages.append(AIMessage(content=content))
        elif role == "tool":
            call_id = item.get("tool_call_id")
            if call_id:
                messages.append(
                    ToolMessage(content=content, tool_call_id=call_id)
                )
        elif role == "system":
            messages.append(SystemMessage(content=content))
    return messages


def build_initial_messages(
    context: dict[str, Any],
    history: list[dict[str, Any]],
) -> list[Any]:
    return [SystemMessage(content=build_system_prompt(context))] + history_to_messages(
        history
    )
