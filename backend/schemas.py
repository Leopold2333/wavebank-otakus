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
}


AUDIO_SCHEMA: dict[str, Any] = {
    "task_type": "audio",
    "intent": "audio",
    "title": "音频处理",
    "agent": "media_agent",
    "commonFields": COMMON_OUTPUT_FIELDS,
    "subtypes": AUDIO_SUBTYPE_SCHEMAS,
}


SCHEMAS: dict[str, dict[str, Any]] = {
    "audio": AUDIO_SCHEMA,
    **{
        f"audio.{key}": {
            **value,
            "commonFields": COMMON_OUTPUT_FIELDS,
        }
        for key, value in AUDIO_SUBTYPE_SCHEMAS.items()
    },
    **{
        key: {
            **value,
            "commonFields": COMMON_OUTPUT_FIELDS,
        }
        for key, value in AUDIO_SUBTYPE_SCHEMAS.items()
    },
}
