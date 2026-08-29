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
const MAX_CONVERSATION_MESSAGE_CACHE = 30;

function withMessageCache(
  map: Record<string, ChatMessage[]>,
  key: string,
  messages: ChatMessage[],
): Record<string, ChatMessage[]> {
  const next = { ...map, [key]: messages };
  const keys = Object.keys(next);
  if (keys.length > MAX_CONVERSATION_MESSAGE_CACHE) {
    const stale = keys
      .filter((item) => item !== key && item !== PENDING_FILE_KEY)
      .slice(0, keys.length - MAX_CONVERSATION_MESSAGE_CACHE);
    for (const item of stale) {
      delete next[item];
    }
  }
  return next;
}

interface AgentConversationState {
  /** Agent 会话 ID（独立于任务 ID，一次对话可产生多个任务） */
  conversationId: string | null;
  /** 缓存的会话消息，持久化到 localStorage，刷新/切页后立即可见 */
  messages: ChatMessage[];
  /** 每个会话最近一次的内存消息快照；切走再切回时用于恢复进行中的回复 */
  messagesByConversation: Record<string, ChatMessage[]>;
  /** 是否正在流式输出；放入全局 store，避免路由切换/组件重建后丢失 */
  streaming: boolean;
  /** 当前正在流式输出的 assistant 消息 ID；历史同步据此跳过半成品快照 */
  streamingMessageId: string | null;
  /** 当前流式请求的 AbortController；切换会话/切页时用于中断监听 */
  streamAbortController: AbortController | null;
  /** 切换会话时正在从后端加载历史消息 */
  conversationLoading: boolean;
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
  /** 删除某个会话的消息快照（删除会话时调用） */
  discardConversationCache: (conversationId: string) => void;
  setStreaming: (streaming: boolean) => void;
  setStreamingMessageId: (messageId: string | null) => void;
  setStreamAbortController: (controller: AbortController | null) => void;
  /** 中断当前流式监听并清理流式状态（后端仍会在后台完成本轮） */
  abortStream: () => void;
  setConversationLoading: (loading: boolean) => void;
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
    (set, get) => ({
      conversationId: null,
      messages: [],
      messagesByConversation: {},
      streaming: false,
      streamingMessageId: null,
      streamAbortController: null,
      conversationLoading: false,
      files: {},
      model: '',
      reasoning: 'high',
      setConversation: (conversationId) =>
        set((state) => {
          const old = state.conversationId;
          let nextMap = state.messagesByConversation;
          if (old && old !== conversationId && state.messages.length > 0) {
            nextMap = { ...nextMap, [old]: state.messages };
          }
          let nextMessages: ChatMessage[];
          if (conversationId && conversationId !== old) {
            const cached = nextMap[conversationId];
            if (cached) {
              nextMessages = cached;
              const without = { ...nextMap };
              delete without[conversationId];
              nextMap = without;
            } else if (!old) {
              // 新会话刚创建：把当前乐观消息带到新会话 ID 下
              nextMessages = state.messages;
              if (state.messages.length > 0) {
                nextMap = withMessageCache(
                  nextMap,
                  conversationId,
                  state.messages,
                );
              }
            } else {
              nextMessages = [];
            }
          } else if (!conversationId) {
            nextMessages = [];
          } else {
            nextMessages = state.messages;
          }
          return {
            conversationId,
            messages: nextMessages,
            messagesByConversation: nextMap,
          };
        }),
      setMessages: (messages) =>
        set((state) => {
          const key = state.conversationId ?? PENDING_FILE_KEY;
          return {
            messages,
            messagesByConversation: withMessageCache(
              state.messagesByConversation,
              key,
              messages,
            ),
          };
        }),
      appendMessage: (message) =>
        set((state) => {
          const messages = [...state.messages, message];
          const key = state.conversationId ?? PENDING_FILE_KEY;
          return {
            messages,
            messagesByConversation: withMessageCache(
              state.messagesByConversation,
              key,
              messages,
            ),
          };
        }),
      updateMessage: (id, patch) =>
        set((state) => {
          const messages = state.messages.map((message) =>
            message.id === id ? { ...message, ...patch } : message,
          );
          const key = state.conversationId ?? PENDING_FILE_KEY;
          return {
            messages,
            messagesByConversation: withMessageCache(
              state.messagesByConversation,
              key,
              messages,
            ),
          };
        }),
      discardConversationCache: (conversationId) =>
        set((state) => {
          const nextMap = { ...state.messagesByConversation };
          delete nextMap[conversationId];
          return { messagesByConversation: nextMap };
        }),
      setStreaming: (streaming) => set({ streaming }),
      setStreamingMessageId: (streamingMessageId) => set({ streamingMessageId }),
      setStreamAbortController: (streamAbortController) =>
        set({ streamAbortController }),
      abortStream: () => {
        const controller = get().streamAbortController;
        controller?.abort();
        set({
          streamAbortController: null,
          streaming: false,
          streamingMessageId: null,
        });
      },
      setConversationLoading: (conversationLoading) =>
        set({ conversationLoading }),
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
      reset: () => {
        get().abortStream();
        set((state) => {
          const files = { ...state.files };
          delete files[PENDING_FILE_KEY];
          const messagesByConversation = { ...state.messagesByConversation };
          delete messagesByConversation[PENDING_FILE_KEY];
          return {
            conversationId: null,
            messages: [],
            messagesByConversation,
            streaming: false,
            streamingMessageId: null,
            conversationLoading: false,
            files,
          };
        });
      },
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
