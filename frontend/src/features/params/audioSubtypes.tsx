import type { ReactNode } from 'react';
import {
  ScissorOutlined,
  SoundOutlined,
  SwapOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import type { IntentId } from '../../types';
import type { IntentField } from './intentRegistry';

export type AudioSubtypeId = 'convert' | 'extract' | 'trim' | 'pitch' | 'denoise';

export interface AudioSubtypeDefinition {
  id: AudioSubtypeId;
  label: string;
  description: string;
  icon: ReactNode;
  fields: IntentField[];
}

/** 无损格式：目标码率不生效，参数窗中禁用 */
export const LOSSLESS_OUTPUT_FORMATS = ['wav', 'flac'] as const;

export const COMMON_OUTPUT_FIELDS: IntentField[] = [
  {
    name: 'outputFormat',
    label: '输出格式',
    type: 'select',
    defaultValue: 'mp3',
    options: [
      { label: 'MP3', value: 'mp3' },
      { label: 'WAV', value: 'wav' },
      { label: 'FLAC', value: 'flac' },
      { label: 'AAC', value: 'aac' },
      { label: 'OGG', value: 'ogg' },
    ],
  },
  {
    name: 'outputFileName',
    label: '输出文件名',
    type: 'text',
    placeholder: '不含扩展名，留空用源文件名',
    tooltip: '只改文件名，保存路径仍为任务目录',
  },
  {
    name: 'volumeGain',
    label: '音量增益（dB）',
    type: 'number',
    defaultValue: 0,
    tooltip: '调整音量大小：正数放大，负数衰减，0 表示不变。',
    min: -30,
    max: 30,
    step: 1,
  },
  {
    name: 'loudnessTarget',
    label: '响度标准化（LUFS）',
    type: 'select',
    defaultValue: '',
    tooltip: '统一音频响度到指定标准，让不同音频听起来音量一致。',
    options: [
      { label: '不标准化', value: '' },
      { label: '-16 LUFS', value: '-16' },
      { label: '-14 LUFS', value: '-14' },
      { label: '-12 LUFS', value: '-12' },
      { label: '-10 LUFS', value: '-10' },
      { label: '-9 LUFS', value: '-9' },
    ],
  },
  {
    name: 'truePeakMax',
    label: '真峰值上限（dBTP）',
    type: 'number',
    placeholder: '留空 = 跟随原始文件',
    tooltip: '限制输出真实峰值，防止削波；留空自动沿用源文件真实峰值。',
    min: -9,
    max: 0,
    step: 0.1,
  },
  {
    name: 'channels',
    label: '声道数',
    type: 'select',
    defaultValue: '',
    options: [
      { label: '保持原声道', value: '' },
      { label: '单声道', value: '1' },
      { label: '双声道', value: '2' },
      { label: '5.1 声道', value: '6' },
    ],
  },
  {
    name: 'sampleRate',
    label: '目标采样率',
    type: 'select',
    defaultValue: '44100',
    tooltip: '设置输出音频的采样率，采样率越高细节越多，文件越大。',
    options: [
      { label: '16 kHz', value: '16000' },
      { label: '22.05 kHz', value: '22050' },
      { label: '44.1 kHz', value: '44100' },
      { label: '48 kHz', value: '48000' },
      { label: '96 kHz', value: '96000' },
    ],
  },
  {
    name: 'bitrate',
    label: '目标码率',
    type: 'select',
    defaultValue: '320k',
    tooltip: '设置输出音频的编码码率，码率越高音质越好，文件越大。',
    options: [
      { label: '128 kbps', value: '128k' },
      { label: '192 kbps', value: '192k' },
      { label: '256 kbps', value: '256k' },
      { label: '320 kbps', value: '320k' },
    ],
  },
];

export const AUDIO_SUBTYPES: AudioSubtypeDefinition[] = [
  {
    id: 'convert',
    label: '格式转换',
    description: '在常见音频格式之间直接转换',
    icon: <SwapOutlined />,
    fields: [],
  },
  {
    id: 'extract',
    label: '视频提取音频',
    description: '从视频文件中提取音轨',
    icon: <VideoCameraOutlined />,
    fields: [
      {
        name: 'audioTrack',
        label: '音轨序号',
        type: 'number',
        defaultValue: 0,
        min: 0,
        max: 32,
        step: 1,
        tooltip: '0 表示默认音轨',
      },
    ],
  },
  {
    id: 'trim',
    label: '音频裁切',
    description: '按时间裁剪音频片段',
    icon: <ScissorOutlined />,
    fields: [
      {
        name: 'startTime',
        label: '开始时间（秒）',
        type: 'number',
        defaultValue: 0,
        min: 0,
        step: 0.1,
      },
      {
        name: 'duration',
        label: '时长（秒）',
        type: 'number',
        defaultValue: 10,
        min: 0.1,
        step: 0.1,
        tooltip: '留空表示裁到文件末尾',
      },
    ],
  },
  {
    id: 'pitch',
    label: '变速变调',
    description: '调整音高与播放速度',
    icon: <SoundOutlined />,
    fields: [
      {
        name: 'pitchSemitones',
        label: '变调（半音）',
        type: 'number',
        placeholder: '留空 = 自然变调',
        tooltip: '自然变调 = 12×log₂(倍速)，调速时自动填充；手动修改后停止跟随',
        min: -12,
        max: 12,
        step: 1,
      },
      {
        name: 'speed',
        label: '变速（倍速）',
        type: 'number',
        defaultValue: 1,
        min: 0.5,
        max: 100,
        step: 0.05,
        tooltip: '变速倍速（0.5~100），1 为原速',
      },
    ],
  },
  {
    id: 'denoise',
    label: '背景去噪',
    description: '去除录音中的基础背景噪音',
    icon: <SoundOutlined />,
    fields: [
      {
        name: 'denoiseStrength',
        label: '降噪强度（dB）',
        type: 'number',
        defaultValue: 25,
        min: 5,
        max: 60,
        step: 5,
        tooltip: '数值越大去除越强',
      },
    ],
  },
];

export function isAudioSubtypeId(value: string | undefined): value is AudioSubtypeId {
  return !!value && AUDIO_SUBTYPES.some((item) => item.id === value);
}

export const DEFAULT_AUDIO_SUBTYPE = AUDIO_SUBTYPES[0].id;

/** 由功能页路由推导实际音频任务类型；非任务型功能页返回 undefined */
export function taskTypeForIntent(
  intentId: IntentId,
  subtype?: AudioSubtypeId,
): string | undefined {
  if (intentId === 'audio') {
    return `audio.${subtype ?? DEFAULT_AUDIO_SUBTYPE}`;
  }
  if (intentId === 'separation') {
    return 'audio.vocal_separation';
  }
  return undefined;
}

export function getAudioSubtype(id: AudioSubtypeId): AudioSubtypeDefinition {
  return AUDIO_SUBTYPES.find((item) => item.id === id) ?? AUDIO_SUBTYPES[0];
}
