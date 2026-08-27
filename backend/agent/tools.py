"""Agent tool registry.

Tools are plain Python handlers registered under a stable name. The registry
is the single source for both the OpenAI-compatible ``tools`` schemas sent to
the model and the runtime dispatch executed by the LangGraph tools node.
"""

from __future__ import annotations

from typing import Any, Callable

from ..config import load_settings, resolve_project_path
from ..schemas import AUDIO_SUBTYPE_SCHEMAS, COMMON_OUTPUT_FIELDS
from ..tasks import task_manager
from ..tools.ffmpeg import probe_audio_details, resolve_binaries


ToolHandler = Callable[[dict[str, Any], dict[str, Any]], Any]


class ToolDef:
    def __init__(
        self,
        name: str,
        description: str,
        parameters: dict[str, Any],
        handler: ToolHandler,
    ) -> None:
        self.name = name
        self.description = description
        self.parameters = parameters
        self.handler = handler

    def openai_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


_TOOL_REGISTRY: dict[str, ToolDef] = {}


def register_tool(
    name: str,
    description: str,
    parameters: dict[str, Any],
    handler: ToolHandler,
) -> None:
    _TOOL_REGISTRY[name] = ToolDef(name, description, parameters, handler)


def get_tool_schemas() -> list[dict[str, Any]]:
    return [tool.openai_schema() for tool in _TOOL_REGISTRY.values()]


def get_tool_names() -> list[str]:
    return list(_TOOL_REGISTRY)


def dispatch_tool(name: str, arguments: dict[str, Any], context: dict[str, Any]) -> Any:
    tool = _TOOL_REGISTRY.get(name)
    if tool is None:
        raise ValueError(f"未知工具：{name}")
    return tool.handler(dict(arguments or {}), context)


def _field_to_schema(field: dict[str, Any]) -> dict[str, Any]:
    field_type = field.get("type")
    name = field.get("name", "")
    if field_type == "number":
        schema: dict[str, Any] = {"type": "number"}
        if field.get("min") is not None:
            schema["minimum"] = field["min"]
        if field.get("max") is not None:
            schema["maximum"] = field["max"]
        return schema
    if field_type == "switch":
        return {"type": "boolean"}
    if field_type == "select":
        options = field.get("options") or []
        return {
            "type": "string",
            "enum": [str(option["value"]) for option in options],
        }
    if name == "inputFile":
        return {
            "type": "string",
            "description": "输入文件绝对路径，必须来自用户附件或 probe_media 的探测结果",
        }
    return {"type": "string"}


def _audio_tool_schema(subtype_key: str, schema: dict[str, Any]) -> dict[str, Any]:
    task_type = str(schema["task_type"])
    common_fields = schema.get("commonFields") or COMMON_OUTPUT_FIELDS
    properties: dict[str, Any] = {}
    required: list[str] = []
    for field in [
        *schema.get("fields", []),
        *schema.get("advancedFields", []),
        *common_fields,
    ]:
        name = field.get("name", "")
        if not name or name in properties:
            continue
        properties[name] = _field_to_schema(field)
        if field.get("required"):
            required.append(name)
    if "inputFile" not in properties:
        properties["inputFile"] = _field_to_schema(
            {"name": "inputFile", "type": "text", "required": True}
        )
    if "inputFile" not in required:
        required.append("inputFile")
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


def _list_msst_models(arguments: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    from ..msst import describe_msst_runtime

    runtime = describe_msst_runtime()
    return {
        "available": runtime["available"],
        "default_model": runtime["defaultModel"],
        "model_dir": runtime["modelDir"],
        "models": [
            {
                "name": model["name"],
                "architecture": model["architecture"],
                "size_bytes": model["sizeBytes"],
                "downloaded": model.get("downloaded", False),
                "default_inference_params": model.get("defaultInferenceParams"),
            }
            for model in runtime["models"]
        ],
        "error": runtime.get("error") or None,
    }


def _probe_media(arguments: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    path = str(arguments.get("path") or "").strip()
    resolved = resolve_project_path(path)
    if resolved is None or not resolved.is_file():
        raise ValueError(f"文件不存在：{path}")
    return probe_audio_details(str(resolved))


def _get_task_status(arguments: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    task_id = str(arguments.get("task_id") or "").strip()
    if not task_id:
        raise ValueError("缺少 task_id")
    task = task_manager.get_task(task_id)
    return {
        "task_id": task["id"],
        "task_type": task["type"],
        "status": task["status"],
        "progress": task["progress"],
        "target_path": task.get("target_path"),
        "outputs": task.get("outputs", []),
        "error": task.get("error"),
    }


def _make_create_audio_task_handler(task_type: str) -> ToolHandler:
    def _create_audio_task(
        arguments: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        params = dict(arguments or {})
        input_path = resolve_project_path(params.get("inputFile"))
        if input_path is None or not input_path.is_file():
            raise ValueError(f"输入文件不存在：{params.get('inputFile')}")
        task = task_manager.create_audio_task(
            params,
            task_type=task_type,
            mode="new",
            conversation_id=context.get("conversation_id"),
        )
        return {
            "task_id": task["id"],
            "task_type": task["type"],
            "status": task["status"],
            "progress": task["progress"],
            "target_path": task.get("target_path"),
            "message": "任务已创建并进入处理队列，可调用 get_task_status 查询进度",
        }

    return _create_audio_task


def _create_audio_pipeline(
    arguments: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any]:
    params = dict(arguments or {})
    input_path = resolve_project_path(params.get("inputFile"))
    if input_path is None or not input_path.is_file():
        raise ValueError(f"输入文件不存在：{params.get('inputFile')}")
    task = task_manager.create_audio_task(
        params,
        task_type="audio.pipeline",
        mode="new",
        conversation_id=context.get("conversation_id"),
    )
    return {
        "task_id": task["id"],
        "task_type": task["type"],
        "status": task["status"],
        "progress": task["progress"],
        "target_path": task.get("target_path"),
        "message": "编排任务已创建并进入处理队列；中间输出会自动作为下一步输入",
    }


def _register_builtin_tools() -> None:
    register_tool(
        "probe_media",
        "探测本地媒体文件（音频/视频）的详细信息：容器、时长、码率、音视频流、响度与真峰值等，用于确认输入文件可用。",
        {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "要探测的文件绝对路径",
                }
            },
            "required": ["path"],
            "additionalProperties": False,
        },
        _probe_media,
    )
    register_tool(
        "get_task_status",
        "查询已创建音频处理任务的状态、进度与输出路径。",
        {
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "创建任务工具返回的任务 ID",
                }
            },
            "required": ["task_id"],
            "additionalProperties": False,
        },
        _get_task_status,
    )
    register_tool(
        "list_msst_models",
        "列出本地 pymss 目录中支持的人声分离（MSST）模型清单与默认模型，供 audio_vocal_separation 的 modelName 参数选择。",
        {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        _list_msst_models,
    )
    for subtype_key, schema in AUDIO_SUBTYPE_SCHEMAS.items():
        task_type = str(schema["task_type"])
        tool_name = task_type.replace(".", "_")
        register_tool(
            tool_name,
            (
                f"{schema['title']}（{task_type}）：{schema['description']}。"
                "在后台创建处理任务，返回任务 ID；创建后可用 get_task_status 查询进度。"
            ),
            _audio_tool_schema(subtype_key, schema),
            _make_create_audio_task_handler(task_type),
        )
    register_tool(
        "audio_pipeline",
        "创建一个顺序执行的音频编排任务；系统会自动把每一步输出作为下一步输入，并只返回一个任务 ID。",
        {
            "type": "object",
            "properties": {
                "inputFile": {
                    "type": "string",
                    "description": "起始输入文件绝对路径，必须来自用户附件或探测结果",
                },
                "steps": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 8,
                    "items": {
                        "type": "object",
                        "properties": {
                            "taskType": {
                                "type": "string",
                                "enum": [
                                    "audio.convert",
                                    "audio.extract",
                                    "audio.trim",
                                    "audio.pitch",
                                    "audio.denoise",
                                    "audio.vocal_separation",
                                ],
                            },
                            "params": {
                                "type": "object",
                                "description": "该步骤独有参数；不要填写 inputFile，系统会自动接上一步输出；audio.vocal_separation 只能作为最后一步",
                            },
                        },
                        "required": ["taskType"],
                        "additionalProperties": False,
                    },
                },
                "outputFormat": {
                    "type": "string",
                    "enum": ["mp3", "wav", "flac", "aac", "ogg"],
                },
                "outputFileName": {"type": "string"},
                "bitrate": {"type": "string"},
                "sampleRate": {"type": "string"},
                "channels": {"type": "string"},
                "volumeGain": {"type": "number"},
                "loudnessTarget": {"type": "string"},
                "truePeakMax": {"type": "number"},
            },
            "required": ["inputFile", "steps"],
            "additionalProperties": False,
        },
        _create_audio_pipeline,
    )


_register_builtin_tools()
