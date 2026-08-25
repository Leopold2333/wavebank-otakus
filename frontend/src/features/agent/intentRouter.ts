import { INTENT_MAP } from '../params/intentRegistry';
import type { IntentId } from '../../types';

interface KeywordRule {
  intent: IntentId;
  keywords: string[];
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    intent: 'usb',
    keywords: ['u盘', 'usb', '车载', '车机', 'fat32'],
  },
  {
    intent: 'separation',
    keywords: ['人声', '伴奏', '分离', '去人声', 'stem'],
  },
  {
    intent: 'denoise',
    keywords: ['降噪', '去噪', '噪音', '杂音', '底噪', '电流声', '演唱会'],
  },
  {
    intent: 'creative',
    keywords: ['翻唱', '音色', '升降', '变调', '半音', 'key'],
  },
  {
    intent: 'batch',
    keywords: ['批量', '重命名', '序号', '排序', '文件夹'],
  },
  {
    intent: 'audio',
    keywords: [
      '音频',
      '音量',
      '响度',
      '采样率',
      '比特率',
      '声道',
      '格式',
      '转换',
      '提取音频',
      'mp3',
      'wav',
      'flac',
      'aac',
      'ogg',
    ],
  },
];

export function resolveIntent(input: string): IntentId {
  const normalized = input.toLocaleLowerCase();
  const matched = KEYWORD_RULES.find((rule) =>
    rule.keywords.some((keyword) => normalized.includes(keyword.toLocaleLowerCase())),
  );
  return matched?.intent ?? 'system';
}

export function buildAgentReply(intent: IntentId) {
  const definition = INTENT_MAP[intent];
  return `已为你路由到 **${definition.label}**（${definition.agent}）。\n\n上方参数窗已加载对应的配置窗，并默认保持折叠；展开后即可检查或修改参数。\n\n当前为前端演示模式，接入后端 /api/agents/chat 后，我会在这里流式输出执行计划、工具调用记录与参数建议。`;
}
