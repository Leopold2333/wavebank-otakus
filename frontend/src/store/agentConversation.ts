import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ChatMessage } from '../types';

export type AgentReasoningLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

export interface ConversationFile {
  name: string;
  path: string;
  size: number;
}

const PENDING_FILE_KEY = '__pending__';
const MAX_CONVERSATION_FILES = 30;

interface AgentConversationState {
  /** Agent 会话 ID（独立于任务 ID，一次对话可产生多个任务） */
  conversationId: string | null;
  /** 缓存的会话消息，持久化到 localStorage，刷新/切页后立即可见 */
  messages: ChatMessage[];
  /** 是否正在流式输出；放入全局 store，避免路由切换/组件重建后丢失 */
  streaming: boolean;
  /** 当前正在流式输出的 assistant 消息 ID；历史同步据此跳过半成品快照 */
  streamingMessageId: string | null;
  /** 每个会话最近一次附加的输入文件（会话独立，不参与任务缓存） */
  files: Record<string, ConversationFile | null>;
  /** Agent 对话框内选择的模型；空字符串表示使用设置中的默认模型 */
  model: string;
  /** 推理强度：off 表示关闭思考；low/medium/high/max 自动开启思考 */
  reasoning: AgentReasoningLevel;
  setConversation: (conversationId: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  appendMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  setStreaming: (streaming: boolean) => void;
  setStreamingMessageId: (messageId: string | null) => void;
  /** 保存某个会话的输入文件；conversationId 为空时暂存，待会话创建后绑定 */
  setConversationFile: (
    conversationId: string | null,
    file: ConversationFile | null,
  ) => void;
  /** 新会话创建后，把暂存文件绑定到真实会话 ID */
  bindPendingFile: (conversationId: string) => void;
  setModel: (model: string) => void;
  setReasoning: (reasoning: AgentReasoningLevel) => void;
  reset: () => void;
}

export const useAgentConversationStore = create<AgentConversationState>()(
  persist(
    (set) => ({
      conversationId: null,
      messages: [],
      streaming: false,
      streamingMessageId: null,
      files: {},
      model: '',
      reasoning: 'high',
      setConversation: (conversationId) => set({ conversationId }),
      setMessages: (messages) => set({ messages }),
      appendMessage: (message) =>
        set((state) => ({ messages: [...state.messages, message] })),
      updateMessage: (id, patch) =>
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === id ? { ...message, ...patch } : message,
          ),
        })),
      setStreaming: (streaming) => set({ streaming }),
      setStreamingMessageId: (streamingMessageId) => set({ streamingMessageId }),
      setConversationFile: (conversationId, file) =>
        set((state) => {
          const key = conversationId ?? PENDING_FILE_KEY;
          const files = { ...state.files, [key]: file };
          const keys = Object.keys(files);
          if (keys.length > MAX_CONVERSATION_FILES) {
            const stale = keys
              .filter((item) => item !== PENDING_FILE_KEY)
              .slice(0, keys.length - MAX_CONVERSATION_FILES);
            for (const item of stale) {
              delete files[item];
            }
          }
          return { files };
        }),
      bindPendingFile: (conversationId) =>
        set((state) => {
          const pending = state.files[PENDING_FILE_KEY];
          if (!conversationId || !pending) {
            return state;
          }
          const files = { ...state.files, [conversationId]: pending };
          delete files[PENDING_FILE_KEY];
          return { files };
        }),
      setModel: (model) => set({ model }),
      setReasoning: (reasoning) => set({ reasoning }),
      reset: () =>
        set((state) => {
          const files = { ...state.files };
          delete files[PENDING_FILE_KEY];
          return {
            conversationId: null,
            messages: [],
            streaming: false,
            streamingMessageId: null,
            files,
          };
        }),
    }),
    {
      name: 'wavebank:agent-conversation',
      storage: createJSONStorage(() => localStorage),
      version: 4,
      partialize: (state) => ({
        conversationId: state.conversationId,
        messages: state.messages,
        files: state.files,
        model: state.model,
        reasoning: state.reasoning,
      }),
      migrate: (persisted) => {
        const state = persisted as Partial<AgentConversationState> & {
          reasoningEffort?: string;
          thinking?: boolean;
          taskId?: string;
          inputFile?: string | null;
          files?: Record<string, ConversationFile | null>;
        };
        // v1 中会话绑定在 agent.chat 任务 ID 下；v2 起使用独立的会话 ID；
        // v3 起会话不再绑定输入文件，仅保留会话 ID 与消息本身。
        return {
          conversationId: state.conversationId ?? null,
          messages: state.messages ?? [],
          files: state.files ?? {},
          model: state.model ?? '',
          reasoning:
            state.reasoning ??
            (state.thinking === false
              ? 'off'
              : ((state.reasoningEffort as AgentReasoningLevel) ?? 'high')),
        };
      },
    },
  ),
);

export function selectConversationFile(
  state: AgentConversationState,
  conversationId: string | null,
): ConversationFile | null {
  return state.files[conversationId ?? PENDING_FILE_KEY] ?? null;
}
