import type { ReactNode } from 'react';
import {
  AudioOutlined,
  ClearOutlined,
  FileDoneOutlined,
  FireOutlined,
  ScissorOutlined,
  ToolOutlined,
  UsbOutlined,
} from '@ant-design/icons';
import type { IntentId } from '../../types';

export interface IntentFieldOption {
  label: string;
  value: string | number;
  /** 供 Select 模糊搜索的附加文本（别名/分类等） */
  searchText?: string;
}

export interface IntentField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'switch' | 'slider';
  placeholder?: string;
  tooltip?: string;
  options?: IntentFieldOption[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: string | number | boolean;
  /** 当前条件下该字段不可编辑 */
  disabled?: boolean;
  /** 高级参数：在参数窗中折叠为单独的“高级推理参数”分组 */
  advanced?: boolean;
}

export interface IntentDefinition {
  id: IntentId;
  label: string;
  agent: string;
  description: string;
  icon: ReactNode;
  fields: IntentField[];
}

export const INTENT_DEFINITIONS: IntentDefinition[] = [
  {
    id: 'audio',
    label: '音频处理',
    agent: 'media_agent',
    description: '格式转换、视频提取音频、裁切、变速变调与背景去噪',
    icon: <AudioOutlined />,
    fields: [],
  },
  {
    id: 'batch',
    label: '批量处理',
    agent: 'batch_agent',
    description: '批量排序、序号生成、重命名干跑预览与冲突检测',
    icon: <FileDoneOutlined />,
    fields: [
      {
        name: 'folder',
        label: '目标文件夹',
        type: 'text',
        placeholder: '选择要批量处理的文件夹',
      },
      {
        name: 'sortBy',
        label: '排序方式',
        type: 'select',
        defaultValue: 'natural',
        options: [
          { label: '自然排序（2 < 10）', value: 'natural' },
          { label: '名称排序', value: 'name' },
          { label: '修改时间', value: 'time' },
          { label: '文件大小', value: 'size' },
          { label: '手动排序', value: 'manual' },
        ],
      },
      {
        name: 'template',
        label: '序号模板',
        type: 'text',
        defaultValue: '{seq}_{name}',
        placeholder: '例：{seq}_{name}',
      },
      {
        name: 'zeroPad',
        label: '补零位数',
        type: 'number',
        defaultValue: 2,
        min: 1,
        max: 6,
        step: 1,
      },
      {
        name: 'startAt',
        label: '起始序号',
        type: 'number',
        defaultValue: 1,
        min: 0,
        step: 1,
      },
      {
        name: 'writeTrackTag',
        label: '同步写入 MP3 轨道号',
        type: 'switch',
        defaultValue: false,
      },
    ],
  },
  {
    id: 'separation',
    label: '人声分离',
    agent: 'separation_agent',
    description: '基于 MSST 模型分离人声与伴奏，输出两条音轨',
    icon: <ScissorOutlined />,
    fields: [
      {
        name: 'modelName',
        label: '分离模型',
        type: 'select',
        defaultValue: 'MDX23C-8KFFT-InstVoc_HQ.ckpt',
        tooltip: '模型列表来自后端 pymss 目录；未缓存的模型会在任务执行时自动下载',
        options: [
          { label: 'MDX23C-8KFFT-InstVoc_HQ（默认）', value: 'MDX23C-8KFFT-InstVoc_HQ.ckpt' },
        ],
      },
      {
        name: 'device',
        label: '推理设备',
        type: 'select',
        defaultValue: 'auto',
        options: [
          { label: '自动', value: 'auto' },
          { label: 'CPU', value: 'cpu' },
          { label: 'CUDA', value: 'cuda' },
          { label: 'MPS', value: 'mps' },
          { label: 'MLX', value: 'mlx' },
        ],
      },
      {
        name: 'useTta',
        label: '测试时增强（TTA）',
        type: 'switch',
        defaultValue: false,
        advanced: true,
        tooltip: '正放 / 倒放 / 取反三路推理取平均，质量略有提升，耗时约 3 倍',
      },
      {
        name: 'batchSize',
        label: '推理批大小',
        type: 'number',
        min: 1,
        max: 16777216,
        placeholder: '模型默认',
        advanced: true,
        tooltip: '留空使用模型推荐值；增大可提速但占用更多内存',
      },
      {
        name: 'overlapSize',
        label: '分块重叠（采样数）',
        type: 'number',
        min: 1,
        max: 16777216,
        placeholder: '模型默认',
        advanced: true,
        tooltip: '留空使用模型推荐值；增大可减少分块接缝伪影，但更耗时',
      },
      {
        name: 'chunkSize',
        label: '分块大小（采样数）',
        type: 'number',
        min: 1,
        max: 16777216,
        placeholder: '模型默认',
        advanced: true,
        tooltip: '留空使用模型推荐值；调整不当可能降低质量或耗尽内存',
      },
      {
        name: 'standardize',
        label: '输入标准化',
        type: 'switch',
        defaultValue: false,
        advanced: true,
        tooltip: '推理前对输入做标准化，极端偏响/偏轻的源可尝试开启',
      },
      {
        name: 'normalize',
        label: '输出峰值归一化',
        type: 'switch',
        defaultValue: false,
        advanced: true,
        tooltip: '推理后把每条音轨峰值归一到 0 dB',
      },
      {
        name: 'outputFormat',
        label: '输出格式',
        type: 'select',
        defaultValue: 'wav',
        options: [
          { label: 'WAV', value: 'wav' },
          { label: 'FLAC', value: 'flac' },
          { label: 'MP3', value: 'mp3' },
        ],
      },
      {
        name: 'outputFileName',
        label: '输出文件名',
        type: 'text',
        placeholder: '默认沿用输入文件名，产物自动追加 _vocals / _instrumental',
      },
    ],
  },
  {
    id: 'denoise',
    label: '去噪',
    agent: 'denoise_agent',
    description: '演唱会 / 播客 / 电话场景降噪，人声增强与 A/B 对比',
    icon: <ClearOutlined />,
    fields: [
      {
        name: 'inputFile',
        label: '输入音频',
        type: 'text',
        placeholder: '选择需要降噪的音频文件',
      },
      {
        name: 'scene',
        label: '噪声场景',
        type: 'select',
        defaultValue: 'concert',
        options: [
          { label: '演唱会 / 现场录音', value: 'concert' },
          { label: '播客 / 干音', value: 'podcast' },
          { label: '电话 / 网络音频', value: 'telephone' },
        ],
      },
      {
        name: 'strength',
        label: '降噪强度',
        type: 'slider',
        defaultValue: 60,
        min: 0,
        max: 100,
        step: 1,
      },
      {
        name: 'aiEnhance',
        label: 'AI 人声增强',
        type: 'switch',
        defaultValue: false,
        tooltip: '需要模型环境就绪（P2 能力）',
      },
    ],
  },
  {
    id: 'creative',
    label: 'AI 创作',
    agent: 'creative_agent',
    description: 'AI 翻唱、升降 Key、音色模型选择与混音导出',
    icon: <FireOutlined />,
    fields: [
      {
        name: 'mode',
        label: '创作模式',
        type: 'select',
        defaultValue: 'cover',
        options: [
          { label: 'AI 翻唱', value: 'cover' },
          { label: '升降 Key', value: 'key' },
        ],
      },
      {
        name: 'inputFile',
        label: '输入歌曲',
        type: 'text',
        placeholder: '选择要创作的音频文件',
      },
      {
        name: 'voiceModel',
        label: '目标音色模型',
        type: 'select',
        defaultValue: 'none',
        options: [{ label: '待接入本地模型库', value: 'none' }],
      },
      {
        name: 'semitones',
        label: '升降半音（-12 ~ +12）',
        type: 'number',
        defaultValue: 0,
        min: -12,
        max: 12,
        step: 1,
      },
      {
        name: 'outputFormat',
        label: '导出格式',
        type: 'select',
        defaultValue: 'mp3',
        options: [
          { label: 'WAV', value: 'wav' },
          { label: 'FLAC', value: 'flac' },
          { label: 'MP3', value: 'mp3' },
        ],
      },
    ],
  },
  {
    id: 'usb',
    label: '车载 U 盘',
    agent: 'usb_agent',
    description: 'U 盘识别、车载排序、复制到 U 盘与 FAT32 提示',
    icon: <UsbOutlined />,
    fields: [
      {
        name: 'device',
        label: 'U 盘设备',
        type: 'select',
        defaultValue: 'auto',
        options: [{ label: '自动识别（P1 后端接入）', value: 'auto' }],
      },
      {
        name: 'sortBy',
        label: '排序规则',
        type: 'select',
        defaultValue: 'manual',
        options: [
          { label: '手动拖拽排序', value: 'manual' },
          { label: '自然排序', value: 'natural' },
          { label: '按标签排序', value: 'tag' },
        ],
      },
      {
        name: 'zeroPad',
        label: '补零位数',
        type: 'number',
        defaultValue: 2,
        min: 1,
        max: 6,
        step: 1,
      },
      {
        name: 'syncTrackTag',
        label: '写入 ID3 轨道号',
        type: 'switch',
        defaultValue: false,
      },
      {
        name: 'copyToUsb',
        label: '处理后复制到 U 盘',
        type: 'switch',
        defaultValue: false,
        tooltip: '清空目标目录需二次确认',
      },
    ],
  },
  {
    id: 'system',
    label: '系统 / 通用',
    agent: 'system_agent',
    description: '环境检查、文件浏览与通用问答兜底',
    icon: <ToolOutlined />,
    fields: [
      {
        name: 'ffmpegPath',
        label: 'ffmpeg 路径',
        type: 'text',
        placeholder: '默认使用项目配置的 ffmpeg',
      },
      {
        name: 'modelDir',
        label: '模型目录',
        type: 'text',
        placeholder: '本地模型库目录',
      },
      {
        name: 'allowMountPoints',
        label: 'U 盘白名单挂载点',
        type: 'text',
        placeholder: '多个路径用英文逗号分隔',
      },
    ],
  },
];

export const INTENT_MAP = Object.fromEntries(
  INTENT_DEFINITIONS.map((definition) => [definition.id, definition]),
) as Record<IntentId, IntentDefinition>;

export function isIntentId(value: string | undefined): value is IntentId {
  return !!value && value in INTENT_MAP;
}
