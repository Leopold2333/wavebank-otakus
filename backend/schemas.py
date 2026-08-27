from __future__ import annotations

from typing import Any


# 注意：这里只维护字段的结构性元数据（name/type/options/默认值/约束）。
# placeholder、extra 等前端文案统一由 frontend/src/features/params/audioSubtypes.tsx
# 维护，避免同一段文字在后端和前端各存一份导致漂移。
COMMON_OUTPUT_FIELDS: list[dict[str, Any]] = [
    {
        "name": "outputFormat",
        "label": "输出格式",
        "type": "select",
        "defaultValue": "mp3",
        "options": [
            {"label": "MP3", "value": "mp3"},
            {"label": "WAV", "value": "wav"},
            {"label": "FLAC", "value": "flac"},
            {"label": "AAC", "value": "aac"},
            {"label": "OGG", "value": "ogg"},
        ],
    },
    {
        "name": "outputFileName",
        "label": "输出文件名",
        "type": "text",
    },
    {
        "name": "volumeGain",
        "label": "音量增益（dB）",
        "type": "number",
        "defaultValue": 0,
        "min": -30,
        "max": 30,
        "step": 1,
    },
    {
        "name": "loudnessTarget",
        "label": "响度标准化（LUFS）",
        "type": "select",
        "defaultValue": "",
        "options": [
            {"label": "不标准化", "value": ""},
            {"label": "-16 LUFS", "value": "-16"},
            {"label": "-14 LUFS", "value": "-14"},
            {"label": "-12 LUFS", "value": "-12"},
            {"label": "-10 LUFS", "value": "-10"},
            {"label": "-9 LUFS", "value": "-9"},
        ],
    },
    {
        "name": "truePeakMax",
        "label": "真峰值上限（dBTP）",
        "type": "number",
        "min": -9,
        "max": 0,
        "step": 0.1,
    },
    {
        "name": "channels",
        "label": "声道数",
        "type": "select",
        "defaultValue": "",
        "options": [
            {"label": "保持原声道", "value": ""},
            {"label": "单声道", "value": "1"},
            {"label": "双声道", "value": "2"},
            {"label": "5.1 声道", "value": "6"},
        ],
    },
    {
        "name": "sampleRate",
        "label": "目标采样率",
        "type": "select",
        "defaultValue": "44100",
        "options": [
            {"label": "16 kHz", "value": "16000"},
            {"label": "22.05 kHz", "value": "22050"},
            {"label": "44.1 kHz", "value": "44100"},
            {"label": "48 kHz", "value": "48000"},
            {"label": "96 kHz", "value": "96000"},
        ],
    },
    {
        "name": "bitrate",
        "label": "目标码率",
        "type": "select",
        "defaultValue": "320k",
        "options": [
            {"label": "128 kbps", "value": "128k"},
            {"label": "192 kbps", "value": "192k"},
            {"label": "256 kbps", "value": "256k"},
            {"label": "320 kbps", "value": "320k"},
        ],
    },
]


INPUT_FILE_FIELD: dict[str, Any] = {
    "name": "inputFile",
    "label": "输入文件",
    "type": "text",
    "required": True,
}


MSST_OUTPUT_FORMAT_FIELD: dict[str, Any] = {
    "name": "outputFormat",
    "label": "输出格式",
    "type": "select",
    "defaultValue": "wav",
    "options": [
        {"label": "WAV", "value": "wav"},
        {"label": "FLAC", "value": "flac"},
        {"label": "MP3", "value": "mp3"},
    ],
}

MSST_OUTPUT_FILE_NAME_FIELD: dict[str, Any] = {
    "name": "outputFileName",
    "label": "输出文件名",
    "type": "text",
}

# 人声分离不走 ffmpeg，公共输出字段只有格式与文件名；产物固定追加
# _vocals / _instrumental 后缀并输出两条音轨。
MSST_COMMON_OUTPUT_FIELDS: list[dict[str, Any]] = [
    MSST_OUTPUT_FORMAT_FIELD,
    MSST_OUTPUT_FILE_NAME_FIELD,
]


AUDIO_SUBTYPE_SCHEMAS: dict[str, dict[str, Any]] = {
    "convert": {
        "task_type": "audio.convert",
        "intent": "audio",
        "title": "格式转换",
        "agent": "media_agent",
        "description": "在音频格式之间直接转换",
        "fields": [INPUT_FILE_FIELD],
    },
    "extract": {
        "task_type": "audio.extract",
        "intent": "audio",
        "title": "视频提取音频",
        "agent": "media_agent",
        "description": "从视频文件中提取音轨",
        "fields": [
            INPUT_FILE_FIELD,
            {
                "name": "audioTrack",
                "label": "音轨序号",
                "type": "number",
                "defaultValue": 0,
                "min": 0,
                "max": 32,
                "step": 1,
            },
        ],
    },
    "trim": {
        "task_type": "audio.trim",
        "intent": "audio",
        "title": "音频裁切",
        "agent": "media_agent",
        "description": "按时间裁剪音频片段",
        "fields": [
            INPUT_FILE_FIELD,
            {
                "name": "startTime",
                "label": "开始时间（秒）",
                "type": "number",
                "defaultValue": 0,
                "min": 0,
                "step": 0.1,
            },
            {
                "name": "duration",
                "label": "时长（秒）",
                "type": "number",
                "defaultValue": 10,
                "min": 0.1,
                "step": 0.1,
            },
        ],
    },
    "pitch": {
        "task_type": "audio.pitch",
        "intent": "audio",
        "title": "变速变调",
        "agent": "media_agent",
        "description": "调整音高与播放速度",
        "fields": [
            INPUT_FILE_FIELD,
            {
                "name": "pitchSemitones",
                "label": "变调（半音）",
                "type": "number",
                "defaultValue": "",
                "min": -12,
                "max": 12,
                "step": 1,
            },
            {
                "name": "speed",
                "label": "变速（倍速）",
                "type": "number",
                "defaultValue": 1,
                "min": 0.5,
                "max": 100,
                "step": 0.05,
            },
        ],
    },
    "denoise": {
        "task_type": "audio.denoise",
        "intent": "audio",
        "title": "背景去噪",
        "agent": "media_agent",
        "description": "去除录音中的基础背景噪音",
        "fields": [
            INPUT_FILE_FIELD,
            {
                "name": "denoiseStrength",
                "label": "降噪强度（dB）",
                "type": "number",
                "defaultValue": 25,
                "min": 5,
                "max": 60,
                "step": 5,
            },
        ],
    },
    "vocal_separation": {
        "task_type": "audio.vocal_separation",
        "intent": "audio",
        "title": "人声分离",
        "agent": "media_agent",
        "description": "使用 MSST 模型把音频分离为人声与伴奏两条音轨",
        "fields": [
            INPUT_FILE_FIELD,
            {
                "name": "modelName",
                "label": "分离模型",
                "type": "select",
                "defaultValue": "MDX23C-8KFFT-InstVoc_HQ.ckpt",
                "options": [
                    {
                        "label": "MDX23C-8KFFT-InstVoc_HQ（默认）",
                        "value": "MDX23C-8KFFT-InstVoc_HQ.ckpt",
                    },
                    {
                        "label": "MDX23C-8KFFT-InstVoc_HQ_2",
                        "value": "MDX23C-8KFFT-InstVoc_HQ_2.ckpt",
                    },
                    {
                        "label": "MDX23C_D1581（轻量）",
                        "value": "MDX23C_D1581.ckpt",
                    },
                    {
                        "label": "melband_roformer_inst_v2",
                        "value": "melband_roformer_inst_v2.ckpt",
                    },
                ],
            },
            {
                "name": "device",
                "label": "推理设备",
                "type": "select",
                "defaultValue": "auto",
                "options": [
                    {"label": "自动", "value": "auto"},
                    {"label": "CPU", "value": "cpu"},
                    {"label": "CUDA", "value": "cuda"},
                    {"label": "MPS", "value": "mps"},
                    {"label": "MLX", "value": "mlx"},
                ],
            },
        ],
        "advancedFields": [
            {
                "name": "useTta",
                "label": "测试时增强（TTA）",
                "type": "switch",
                "defaultValue": False,
                "tooltip": "正放 / 倒放 / 取反三路推理取平均，质量略有提升，耗时约 3 倍",
            },
            {
                "name": "batchSize",
                "label": "推理批大小",
                "type": "number",
                "min": 1,
                "max": 16777216,
                "placeholder": "模型默认",
                "tooltip": "留空使用模型推荐值；增大可提速但占用更多内存",
            },
            {
                "name": "overlapSize",
                "label": "分块重叠（采样数）",
                "type": "number",
                "min": 1,
                "max": 16777216,
                "placeholder": "模型默认",
                "tooltip": "留空使用模型推荐值；增大可减少分块接缝伪影，但更耗时",
            },
            {
                "name": "chunkSize",
                "label": "分块大小（采样数）",
                "type": "number",
                "min": 1,
                "max": 16777216,
                "placeholder": "模型默认",
                "tooltip": "留空使用模型推荐值；调整不当可能降低质量或耗尽内存",
            },
            {
                "name": "standardize",
                "label": "输入标准化",
                "type": "switch",
                "defaultValue": False,
                "tooltip": "推理前对输入做标准化，极端偏响/偏轻的源可尝试开启",
            },
            {
                "name": "normalize",
                "label": "输出峰值归一化",
                "type": "switch",
                "defaultValue": False,
                "tooltip": "推理后把每条音轨峰值归一到 0 dB",
            },
        ],
        "commonFields": MSST_COMMON_OUTPUT_FIELDS,
    },
}


AUDIO_SCHEMA: dict[str, Any] = {
    "task_type": "audio",
    "intent": "audio",
    "title": "音频处理",
    "agent": "media_agent",
    "commonFields": COMMON_OUTPUT_FIELDS,
    "subtypes": AUDIO_SUBTYPE_SCHEMAS,
}


AUDIO_PIPELINE_SCHEMA: dict[str, Any] = {
    "task_type": "audio.pipeline",
    "intent": "audio",
    "title": "音频编排",
    "agent": "media_agent",
    "description": "按顺序执行多个音频处理步骤，并自动把上一步输出作为下一步输入",
    "fields": [INPUT_FILE_FIELD],
    "commonFields": COMMON_OUTPUT_FIELDS,
}


SCHEMAS: dict[str, dict[str, Any]] = {
    "audio": AUDIO_SCHEMA,
    "audio.pipeline": AUDIO_PIPELINE_SCHEMA,
    **{
        f"audio.{key}": {
            **value,
            "commonFields": value.get("commonFields", COMMON_OUTPUT_FIELDS),
        }
        for key, value in AUDIO_SUBTYPE_SCHEMAS.items()
    },
    **{
        key: {
            **value,
            "commonFields": value.get("commonFields", COMMON_OUTPUT_FIELDS),
        }
        for key, value in AUDIO_SUBTYPE_SCHEMAS.items()
    },
}
