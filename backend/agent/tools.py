"""Agent tool registry.

Tools are plain Python handlers registered under a stable name. The registry
is the single source for both the OpenAI-compatible ``tools`` schemas sent to
the model and the runtime dispatch executed by the LangGraph tools node.
"""

from __future__ import annotations

import time
from typing import Any, Callable

from ..config import load_settings, resolve_project_path
from ..schemas import AUDIO_SUBTYPE_SCHEMAS, COMMON_OUTPUT_FIELDS
from ..tasks import TERMINAL_STATUSES, task_manager
from ..tools.ffmpeg import probe_audio_details, resolve_binaries


ToolHandler = Callable[[dict[str, Any], dict[str, Any]], Any]

EMPTY_SECONDARY_KEY = "__default__"


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
        if field.get("multiple"):
            items: dict[str, Any] = {"type": "string"}
            if options:
                items["enum"] = [str(option["value"]) for option in options]
            return {"type": "array", "items": items}
        if not options:
            return {"type": "string"}
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


def _msst_catalog_snapshot() -> dict[str, Any]:
    from ..msst import describe_pymss_catalog

    return describe_pymss_catalog()


def _list_msst_categories(
    arguments: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any]:
    catalog = _msst_catalog_snapshot()
    super_categories = [
        {
            "key": "separation",
            "label": "人声-伴奏类分离",
            "primaryCategories": [
                {
                    "primaryCategory": primary["primaryCategory"],
                    "primaryCategoryCn": primary["primaryCategoryCn"],
                    "modelCount": sum(
                        len(secondary["models"])
                        for secondary in primary["secondaryCategories"]
                    ),
                    "defaultModel": primary.get("defaultModel", ""),
                }
                for primary in catalog.get("categories", [])
                if primary["primaryCategory"]
                in {
                    "vocal",
                    "legacy_vr",
                    "legacy_models",
                    "instrumental",
                    "single_instrument",
                    "karaoke",
                    "spatial",
                    "experimental_general",
                    "music_stems",
                    "special",
                }
            ],
        },
        {
            "key": "post",
            "label": "后处理类",
            "primaryCategories": [
                {
                    "primaryCategory": primary["primaryCategory"],
                    "primaryCategoryCn": primary["primaryCategoryCn"],
                    "modelCount": sum(
                        len(secondary["models"])
                        for secondary in primary["secondaryCategories"]
                    ),
                    "defaultModel": primary.get("defaultModel", ""),
                }
                for primary in catalog.get("categories", [])
                if primary["primaryCategory"] in {"cleanup", "reverb_echo_control"}
            ],
        },
    ]
    return {
        "available": catalog.get("available", False),
        "error": catalog.get("error") or None,
        "super_categories": super_categories,
    }


def _list_msst_secondary_categories(
    arguments: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any]:
    catalog = _msst_catalog_snapshot()
    primary_key = str(arguments.get("primaryCategory") or "").strip()
    if not primary_key:
        raise ValueError("缺少 primaryCategory")
    primary = next(
        (
            item
            for item in catalog.get("categories", [])
            if item["primaryCategory"] == primary_key
        ),
        None,
    )
    if primary is None:
        available = ", ".join(
            item["primaryCategory"] for item in catalog.get("categories", [])
        )
        raise ValueError(f"未知大类：{primary_key}（可选：{available}）")
    return {
        "available": True,
        "primary_category": primary["primaryCategory"],
        "primary_category_cn": primary["primaryCategoryCn"],
        "secondary_categories": [
            {
                "secondaryCategory": secondary["secondaryCategory"]
                or EMPTY_SECONDARY_KEY,
                "secondaryCategoryCn": secondary["secondaryCategoryCn"],
                "modelCount": len(secondary["models"]),
                "defaultModel": secondary.get("defaultModel", ""),
            }
            for secondary in primary["secondaryCategories"]
        ],
        "error": None,
    }


def _list_msst_models(
    arguments: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any]:
    catalog = _msst_catalog_snapshot()
    secondary_key = str(arguments.get("secondaryCategory") or "").strip()
    if not secondary_key:
        raise ValueError("缺少 secondaryCategory")
    primary_key = str(arguments.get("primaryCategory") or "").strip()
    found: tuple[dict[str, Any], dict[str, Any]] | None = None
    for primary in catalog.get("categories", []):
        if primary_key and primary["primaryCategory"] != primary_key:
            continue
        for secondary in primary["secondaryCategories"]:
            target_key = (
                EMPTY_SECONDARY_KEY
                if secondary["secondaryCategory"] == ""
                else secondary["secondaryCategory"]
            )
            if target_key == secondary_key:
                found = (primary, secondary)
                break
        if found is not None:
            break
    if found is None:
        raise ValueError(f"未知任务小类：{secondary_key}，请先用 list_msst_secondary_categories 查询")
    primary, secondary = found
    return {
        "available": True,
        "primary_category": primary["primaryCategory"],
        "primary_category_cn": primary["primaryCategoryCn"],
        "secondary_category": secondary["secondaryCategory"]
        or EMPTY_SECONDARY_KEY,
        "secondary_category_cn": secondary["secondaryCategoryCn"],
        "default_model": secondary.get("defaultModel", ""),
        "models": secondary["models"],
        "error": None,
    }


def _download_msst_model(
    arguments: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any]:
    from ..msst import start_model_download

    model_name = str(arguments.get("modelName") or "").strip()
    if not model_name:
        raise ValueError("缺少 modelName")
    state = start_model_download(model_name)
    if state.get("status") in {"done", "error", "cancelled"}:
        return state
    return _wait_for_download_completion(model_name, context)


def _wait_for_download_completion(
    model_name: str,
    context: dict[str, Any],
) -> dict[str, Any]:
    """Block until a model download reaches a terminal state."""
    from ..msst import get_model_downloads

    emit = context.get("emit")
    last_progress = -1.0
    last_stage: Any = None
    while True:
        downloads = get_model_downloads()
        state = next(
            (item for item in downloads if item.get("modelName") == model_name),
            None,
        )
        if state is None:
            return {
                "modelName": model_name,
                "status": "error",
                "progress": 0.0,
                "stage": "下载失败",
                "logs": [],
                "downloaded": [],
                "skipped": [],
                "message": "下载状态丢失",
                "startedAt": "",
                "updatedAt": "",
            }
        status = str(state.get("status") or "")
        if status in {"done", "error", "cancelled"}:
            return state
        progress = round(float(state.get("progress") or 0.0), 1)
        stage = state.get("stage")
        if emit and (progress != last_progress or stage != last_stage):
            last_progress = progress
            last_stage = stage
            emit(
                "tool_progress",
                {
                    "tool_call_id": context.get("tool_call_id"),
                    "task_id": None,
                    "status": status,
                    "progress": progress,
                    "stage": stage,
                },
            )
        time.sleep(1)


def _get_msst_download_status(
    arguments: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any]:
    from ..msst import get_model_downloads

    model_name = str(arguments.get("modelName") or "").strip()
    downloads = get_model_downloads()
    if model_name:
        downloads = [
            item for item in downloads if item["modelName"] == model_name
        ]
    return {"downloads": downloads}


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
        "stage": task.get("stage"),
        "logs": (task.get("logs") or [])[-20:],
        "target_path": task.get("target_path"),
        "outputs": task.get("outputs", []),
        "error": task.get("error"),
        "updated_at": task.get("updated_at"),
    }


def _wait_for_task_completion(
    task_id: str,
    context: dict[str, Any],
) -> dict[str, Any]:
    """Block until a background audio task reaches a terminal state.

    Progress is streamed to the browser through ``context["emit"]`` so the
    Agent UI can show live progress while the LLM waits for the final result.
    """
    emit = context.get("emit")
    last_progress = -1.0
    last_stage: Any = None
    while True:
        try:
            task = task_manager.get_task(task_id)
        except KeyError:
            return {
                "task_id": task_id,
                "task_type": "",
                "status": "deleted",
                "progress": 0.0,
                "stage": None,
                "target_path": None,
                "outputs": [],
                "error": "任务记录已删除",
                "message": "任务已结束（deleted）",
                "updated_at": None,
            }
        status = str(task.get("status") or "")
        if status in TERMINAL_STATUSES:
            return {
                "task_id": task["id"],
                "task_type": task["type"],
                "status": status,
                "progress": task.get("progress", 0.0),
                "stage": task.get("stage"),
                "target_path": task.get("target_path"),
                "outputs": task.get("outputs", []),
                "error": task.get("error"),
                "message": (
                    "任务处理完成"
                    if status == "completed"
                    else f"任务已结束（{status}）"
                ),
                "updated_at": task.get("updated_at"),
            }
        progress = round(float(task.get("progress") or 0.0), 1)
        stage = task.get("stage")
        if emit and (progress != last_progress or stage != last_stage):
            last_progress = progress
            last_stage = stage
            emit(
                "tool_progress",
                {
                    "tool_call_id": context.get("tool_call_id"),
                    "task_id": task_id,
                    "status": status,
                    "progress": progress,
                    "stage": stage,
                },
            )
        time.sleep(1)


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
        return _wait_for_task_completion(task["id"], context)

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
    return _wait_for_task_completion(task["id"], context)


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
        "list_msst_categories",
        "列出 MSST 模型库的超大类（人声-伴奏类分离 / 后处理类）及其下的大类列表，包含每个大类的模型数量与默认模型。人声分离选模型的第一步。",
        {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        _list_msst_categories,
    )
    register_tool(
        "list_msst_secondary_categories",
        "列出指定大类（primaryCategory）下的任务小类列表，包含每个小类的模型数量与默认模型。人声分离选模型的第二步。",
        {
            "type": "object",
            "properties": {
                "primaryCategory": {
                    "type": "string",
                    "description": "来自 list_msst_categories 的 primaryCategory",
                }
            },
            "required": ["primaryCategory"],
            "additionalProperties": False,
        },
        _list_msst_secondary_categories,
    )
    register_tool(
        "list_msst_models",
        "列出指定任务小类（secondaryCategory）下的模型列表，包含默认模型、下载状态、目标音轨与支持音轨等，供 audio_vocal_separation 的 modelName 与 selectedStems 参数选择。人声分离选模型的第三步。",
        {
            "type": "object",
            "properties": {
                "secondaryCategory": {
                    "type": "string",
                    "description": "来自 list_msst_secondary_categories 的 secondaryCategory",
                },
                "primaryCategory": {
                    "type": "string",
                    "description": "可选的限定大类，用于消除同名小类歧义",
                },
            },
            "required": ["secondaryCategory"],
            "additionalProperties": False,
        },
        _list_msst_models,
    )
    register_tool(
        "download_msst_model",
        "可选预下载工具：下载指定的 MSST 模型并同步等待完成，工具结果直接返回最终下载状态。不调用也不影响任务，audio_vocal_separation / audio_pipeline 执行时会自动下载缺失模型。仅当用户明确要求“先下载模型”时才使用。",
        {
            "type": "object",
            "properties": {
                "modelName": {
                    "type": "string",
                    "description": "来自 list_msst_models 的模型 name",
                }
            },
            "required": ["modelName"],
            "additionalProperties": False,
        },
        _download_msst_model,
    )
    register_tool(
        "get_msst_download_status",
        "查询 MSST 模型的后台下载状态与进度；不传 modelName 时返回全部下载任务。",
        {
            "type": "object",
            "properties": {
                "modelName": {
                    "type": "string",
                    "description": "可选的模型名称，留空查询全部",
                }
            },
            "additionalProperties": False,
        },
        _get_msst_download_status,
    )
    for subtype_key, schema in AUDIO_SUBTYPE_SCHEMAS.items():
        task_type = str(schema["task_type"])
        tool_name = task_type.replace(".", "_")
        register_tool(
            tool_name,
            (
                f"{schema['title']}（{task_type}）：{schema['description']}。"
                "创建处理任务并同步等待其完成，工具结果会直接返回最终状态、输出文件与错误信息，无需再调用 get_task_status 轮询。"
            ),
            _audio_tool_schema(subtype_key, schema),
            _make_create_audio_task_handler(task_type),
        )
    register_tool(
        "audio_pipeline",
        "创建一个顺序执行的音频编排任务并同步等待其完成；系统会自动把每一步输出作为下一步输入，工具结果直接返回最终状态、全部输出文件与错误信息，无需再调用 get_task_status 轮询。",
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
                                "description": "该步骤独有参数；不要填写 inputFile，系统会自动接上一步输出。audio.vocal_separation 作为中间步骤时，selectedStems 必须且只能指定一个音轨；作为最后一步时可输出多条音轨",
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
