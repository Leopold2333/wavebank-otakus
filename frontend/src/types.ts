export type IntentId =
  | 'audio'
  | 'batch'
  | 'separation'
  | 'denoise'
  | 'creative'
  | 'usb'
  | 'system';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface AgentToolCall {
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  /** 工具执行期间的实时进度文案（仅流式展示，不持久化） */
  progress?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  intent?: IntentId;
  files?: Array<{
    id: string;
    name: string;
    size: number;
    path: string;
  }>;
  toolCalls?: AgentToolCall[];
  ts: number;
}
