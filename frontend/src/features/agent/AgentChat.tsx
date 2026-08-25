import { Suspense, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button, Input, Tag } from 'antd';
import { FolderOpenOutlined, RobotOutlined, SendOutlined } from '@ant-design/icons';
import {
  getAgentModels,
  getAgentConversationMessages,
  streamAgentChat,
  type AgentChatFile,
  type AgentMessage,
  type AgentModelInfo,
} from '../../api/client';
import { AttachmentList } from '../files/AttachmentList';
import { useFileAttachments } from '../files/FileAttachmentsContext';
import { LocalFilePicker } from '../files/LocalFilePickerLazy';
import {
  selectLatestByInput,
  useTaskCacheStore,
} from '../../store/taskCache';
import {
  useAgentConversationStore,
} from '../../store/agentConversation';
import { AgentModelPicker } from './AgentModelPicker';
import type { AgentToolCall, ChatMessage, IntentId } from '../../types';
import { getAudioSubtype, type AudioSubtypeId } from '../params/audioSubtypes';
import { INTENT_MAP } from '../params/intentRegistry';
import { resolveIntent } from './intentRouter';
import { pathBasename } from '../../utils/format';
import { PanelHeader } from '../layout/PanelHeader';

interface AgentChatProps {
  activeIntent: IntentId | null;
  activeSubtype?: AudioSubtypeId | null;
  onIntentResolved: (intent: IntentId) => void;
  /** 会话创建/更新后通知外层刷新会话列表 */
  onConversationActivity?: () => void;
  /** 新会话创建后通知外层（用于把 URL 更新为 /chat/:id） */
  onConversationCreated?: (conversationId: string) => void;
  /** 流式状态变化通知外层（用于禁用会话切换等） */
  onStreamingChange?: (streaming: boolean) => void;
}

const QUICK_PROMPTS = [
  '把 wav 批量转成 320k 的 mp3',
  '这段演唱会录音很吵，帮我降噪',
  '这首歌把人声和伴奏分开',
  '帮车载 U 盘里的歌曲按顺序重命名',
  '这首歌升 3 个半音',
];

function createMessage(
  role: ChatMessage['role'],
  content: string,
  intent?: IntentId,
  files?: ChatMessage['files'],
  toolCalls?: AgentToolCall[],
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    intent,
    files,
    toolCalls,
    ts: Date.now(),
  };
}

function toChatToolCalls(
  toolCalls: AgentMessage['tool_calls'],
): AgentToolCall[] | undefined {
  const mapped = (toolCalls ?? []).map((call) => ({
    id: call.id,
    name: call.name,
    arguments:
      typeof call.arguments === 'string'
        ? {}
        : (call.arguments as Record<string, unknown>),
    result: call.result,
  }));
  return mapped.length > 0 ? mapped : undefined;
}

function fromAgentMessage(item: AgentMessage): ChatMessage {
  return createMessage(
    item.role as ChatMessage['role'],
    item.content,
    undefined,
    item.files,
    toChatToolCalls(item.tool_calls),
  );
}

const INITIAL_MESSAGES: ChatMessage[] = [
  createMessage(
    'assistant',
    '你好，我是 WaveBank Otakus。\n\n告诉我你想处理什么音频任务？我会在同一个会话 ID 下持续跟进；也可以先在上方人工参数窗里选择任务分类，自行配置参数。\n\n首次使用前，请先在「设置」中配置 Agent API Key。',
  ),
];

export function AgentChat({
  activeIntent,
  activeSubtype,
  onIntentResolved,
  onConversationActivity,
  onConversationCreated,
  onStreamingChange,
}: AgentChatProps) {
  const { attachments, setLocalPaths, removeAttachment } = useFileAttachments();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [models, setModels] = useState<AgentModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState('deepseek-v4-flash');
  const endRef = useRef<HTMLDivElement>(null);
  const toolCallsRef = useRef<AgentToolCall[]>([]);
  /** 流式出错后保留本地错误气泡，不再用服务端快照覆盖 */
  const streamErrorRef = useRef(false);

  const conversationId = useAgentConversationStore((state) => state.conversationId);
  const messages = useAgentConversationStore((state) => state.messages);
  const setConversation = useAgentConversationStore((state) => state.setConversation);
  const setMessages = useAgentConversationStore((state) => state.setMessages);
  const appendMessage = useAgentConversationStore((state) => state.appendMessage);
  const updateMessage = useAgentConversationStore((state) => state.updateMessage);
  const streaming = useAgentConversationStore((state) => state.streaming);
  const setStreaming = useAgentConversationStore((state) => state.setStreaming);
  const setStreamingMessageId = useAgentConversationStore(
    (state) => state.setStreamingMessageId,
  );
  const resetConversation = useAgentConversationStore((state) => state.reset);
  const setConversationFile = useAgentConversationStore(
    (state) => state.setConversationFile,
  );
  const bindPendingFile = useAgentConversationStore(
    (state) => state.bindPendingFile,
  );
  const model = useAgentConversationStore((state) => state.model);
  const reasoning = useAgentConversationStore((state) => state.reasoning);
  const setModel = useAgentConversationStore((state) => state.setModel);
  const setReasoning = useAgentConversationStore((state) => state.setReasoning);

  const inputPath = attachments[0]?.path ?? null;
  const cachedParams = useTaskCacheStore((state) =>
    selectLatestByInput(state, inputPath ?? undefined),
  )?.params;
  const clearTaskInput = useTaskCacheStore((state) => state.clearInput);

  const displayMessages = messages.length > 0 ? messages : INITIAL_MESSAGES;

  useEffect(() => {
    let cancelled = false;
    getAgentModels()
      .then((response) => {
        if (!cancelled) {
          setModels(response.models);
          setDefaultModel(response.default_model ?? '');
        }
      })
      .catch(() => {
        // 模型列表获取失败时退化为仅使用默认模型，不阻塞对话
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [displayMessages, streaming]);

  // 会话 ID 存在时从后端同步历史消息：
  // - 本地无缓存：拉取后恢复展示；
  // - 本地有缓存：先立即展示，再与后端校对；
  // - 后端 404（会话已被删除）：清掉本地缓存，避免陈旧会话一直渲染。
  useEffect(() => {
    if (!conversationId) {
      return;
    }
    if (
      useAgentConversationStore.getState().streaming ||
      useAgentConversationStore.getState().streamingMessageId
    ) {
      // 正在流式输出：本地消息由事件驱动，禁止用后端半成品快照覆盖
      return;
    }
    if (streamErrorRef.current) {
      streamErrorRef.current = false;
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { messages: serverMessages } =
          await getAgentConversationMessages(conversationId);
        if (cancelled) {
          return;
        }
        if (
          useAgentConversationStore.getState().streaming ||
          useAgentConversationStore.getState().streamingMessageId
        ) {
          // 请求期间流式输出已开始，放弃这次可能过期的快照
          return;
        }
        // 把“仅含工具调用、无文本”的 assistant 步骤合并到随后的回复中，
        // 避免历史展示时一个回合裂成多条消息。
        const merged: AgentMessage[] = [];
        for (const item of serverMessages) {
          if (item.role !== 'user' && item.role !== 'assistant') {
            continue;
          }
          const last = merged[merged.length - 1];
          if (
            item.role === 'assistant' &&
            last &&
            last.role === 'assistant' &&
            !last.content
          ) {
            last.content = item.content;
            last.tool_calls = [
              ...(last.tool_calls ?? []),
              ...(item.tool_calls ?? []),
            ];
          } else {
            merged.push({ ...item });
          }
        }
        const restored = merged.map((item) => fromAgentMessage(item));
        // 服务端有消息时以后端为准；服务端为空时保留本地乐观消息，
        // 避免覆盖刚发出的尚未落库的消息。
        if (
          restored.length > 0 ||
          useAgentConversationStore.getState().messages.length === 0
        ) {
          setMessages(restored);
        }
      } catch (error) {
        if (!cancelled && (error as { status?: number }).status === 404) {
          resetConversation();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, resetConversation, setMessages]);

  const handleSend = (raw?: string) => {
    const text = (raw ?? draft).trim();
    const files: AgentChatFile[] = attachments.map(({ id, name, size, path }) => ({
      id,
      name,
      size,
      path,
    }));
    if ((!text && files.length === 0) || streaming) {
      return;
    }

    const effectiveConversationId = conversationId ?? undefined;
    appendMessage(createMessage('user', text, undefined, files));
    setDraft('');
    onIntentResolved(resolveIntent(text));

    const assistantId = crypto.randomUUID();
    toolCallsRef.current = [];
    appendMessage(createMessage('assistant', ''));
    setStreamingMessageId(assistantId);
    setStreaming(true);
    onStreamingChange?.(true);

    void streamAgentChat(
      {
        conversation_id: effectiveConversationId ?? undefined,
        content: text,
        intent: activeIntent,
        subtype: activeSubtype,
        params: cachedParams as Record<string, unknown> | undefined,
        files,
        model: model || undefined,
        reasoning_effort: reasoning === 'off' ? '' : reasoning,
        thinking: reasoning !== 'off',
      },
      {
        onMeta: (newConversationId) => {
          if (newConversationId) {
            bindPendingFile(newConversationId);
            setConversation(newConversationId);
            onConversationCreated?.(newConversationId);
            onConversationActivity?.();
          }
        },
        onDelta: (delta) => {
          const state = useAgentConversationStore.getState();
          const targetId =
            state.streamingMessageId &&
            state.messages.some((message) => message.id === state.streamingMessageId)
              ? state.streamingMessageId
              : assistantId;
          const current =
            state.messages.find((message) => message.id === targetId)?.content ?? '';
          // 多个 SSE chunk 可能在同一轮 microtask 到达；flushSync 保证每个
          // delta 都立即提交渲染，而不是攒到 chat.done 才一次性显示。
          flushSync(() => {
            updateMessage(targetId, { content: current + delta });
          });
        },
        onToolCall: (toolCall) => {
          const state = useAgentConversationStore.getState();
          const targetId =
            state.streamingMessageId &&
            state.messages.some((message) => message.id === state.streamingMessageId)
              ? state.streamingMessageId
              : assistantId;
          toolCallsRef.current = [...toolCallsRef.current, toolCall];
          flushSync(() => {
            updateMessage(targetId, { toolCalls: toolCallsRef.current });
          });
        },
        onDone: (finalMessage) => {
          const state = useAgentConversationStore.getState();
          const targetId =
            state.streamingMessageId &&
            state.messages.some((message) => message.id === state.streamingMessageId)
              ? state.streamingMessageId
              : assistantId;
          const current =
            state.messages.find((message) => message.id === targetId)?.content ?? '';
          const patch: Partial<ChatMessage> = {
            content: finalMessage.content || current,
          };
          const finalToolCalls =
            toChatToolCalls(finalMessage.tool_calls) ??
            (toolCallsRef.current.length > 0 ? toolCallsRef.current : undefined);
          if (finalToolCalls) {
            patch.toolCalls = finalToolCalls;
          }
          flushSync(() => {
            if (state.messages.some((message) => message.id === targetId)) {
              updateMessage(targetId, patch);
            } else if (
              !state.messages.some(
                (message) => message.role === 'assistant' && message.content,
              )
            ) {
              // 本地气泡已被历史快照替换且没有可显示的 assistant 文本时，
              // 直接用服务端最终消息补一个气泡，避免留下空方块。
              appendMessage(
                createMessage(
                  'assistant',
                  patch.content ?? '',
                  undefined,
                  undefined,
                  patch.toolCalls,
                ),
              );
            }
            setStreamingMessageId(null);
            setStreaming(false);
            onStreamingChange?.(false);
            onConversationActivity?.();
          });
        },
        onError: (error) => {
          const state = useAgentConversationStore.getState();
          const targetId =
            state.streamingMessageId &&
            state.messages.some((message) => message.id === state.streamingMessageId)
              ? state.streamingMessageId
              : assistantId;
          streamErrorRef.current = true;
          flushSync(() => {
            updateMessage(targetId, {
              content: `⚠️ ${error}`,
            });
            setStreamingMessageId(null);
            setStreaming(false);
            onStreamingChange?.(false);
          });
        },
      },
    ).catch((error: unknown) => {
      const state = useAgentConversationStore.getState();
      const targetId =
        state.streamingMessageId &&
        state.messages.some((message) => message.id === state.streamingMessageId)
          ? state.streamingMessageId
          : assistantId;
      streamErrorRef.current = true;
      flushSync(() => {
        updateMessage(targetId, {
          content: `⚠️ ${error instanceof Error ? error.message : '流式连接中断'}`,
        });
        setStreamingMessageId(null);
        setStreaming(false);
        onStreamingChange?.(false);
      });
    });
  };

  const currentIntent = activeIntent ? INTENT_MAP[activeIntent] : null;
  const currentSubtype = activeSubtype ? getAudioSubtype(activeSubtype) : null;
  const canSend =
    !streaming && (draft.trim().length > 0 || attachments.length > 0);

  const handleRemoveAttachment = (id: string) => {
    const target = attachments.find((attachment) => attachment.id === id);
    if (target) {
      clearTaskInput(target.path);
    }
    const remaining = attachments.filter((attachment) => attachment.id !== id);
    setConversationFile(
      conversationId,
      remaining[0]
        ? {
            name: remaining[0].name,
            path: remaining[0].path,
            size: remaining[0].size,
          }
        : null,
    );
    removeAttachment(id);
  };

  return (
    <section className="agent-chat">
      <div className="agent-chat__header">
        <PanelHeader icon={<RobotOutlined />}>Agent 对话</PanelHeader>
        {currentIntent ? (
          <Tag color="blue" icon={currentIntent.icon}>
            当前意图：
            {currentIntent.label}
            {currentSubtype ? ` / ${currentSubtype.label}` : ''}
          </Tag>
        ) : (
          <Tag>等待开启任务</Tag>
        )}
        {conversationId ? <Tag>会话 {conversationId.slice(0, 8)}…</Tag> : null}
      </div>

      <div className="agent-chat__messages">
        {displayMessages.map((message) => (
          <div key={message.id} className={`message message--${message.role}`}>
            {message.content ||
              (streaming && message.id === displayMessages.at(-1)?.id
                ? message.toolCalls && message.toolCalls.length > 0
                  ? '正在调用工具…'
                  : '正在思考…'
                : '')}
            {message.toolCalls && message.toolCalls.length > 0 ? (
              <div className="message__tools">
                {message.toolCalls.map((call, index) => {
                  const result = call.result as
                    | {
                        task_id?: string;
                        status?: string;
                        error?: string;
                      }
                    | undefined;
                  const summary = result?.task_id
                    ? `任务 ${result.task_id.slice(0, 8)}${
                        result.status ? ` · ${result.status}` : ''
                      }`
                    : result?.error
                      ? result.error
                      : JSON.stringify(result ?? call.arguments ?? {});
                  return (
                    <div
                      key={call.id ?? index}
                      className="message__tool"
                      title={JSON.stringify({
                        name: call.name,
                        arguments: call.arguments,
                        result: call.result,
                      })}
                    >
                      <span className="message__tool-name">{call.name}</span>
                      <span className="message__tool-summary">{summary}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {message.files && message.files.length > 0 ? (
              <div className="message__files">
                {message.files.map((file) => (
                  <span key={file.id} className="message__file" title={file.path}>
                    {file.name}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="agent-chat__quick">
        {QUICK_PROMPTS.map((prompt) => (
          <Button
            key={prompt}
            size="small"
            type="dashed"
            disabled={streaming}
            onClick={() => handleSend(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>

      {attachments.length > 0 ? (
        <div className="agent-chat__attachments">
          <AttachmentList attachments={attachments} onRemove={handleRemoveAttachment} />
        </div>
      ) : null}

      <div className="agent-chat__composer">
        <Input.TextArea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={(event) => {
            if (event.shiftKey) {
              return;
            }
            event.preventDefault();
            handleSend();
          }}
          placeholder="描述你的音频处理需求，例如：把这段录音统一音量并转成 320k mp3"
          autoSize={{ minRows: 1, maxRows: 4 }}
        />
        <div className="agent-chat__composer-actions">
          <Button
            icon={<FolderOpenOutlined />}
            aria-label="添加本机文件"
            onClick={() => setPickerOpen(true)}
          />
          <div className="agent-chat__composer-right">
            <AgentModelPicker
              model={model}
              defaultModel={defaultModel}
              reasoning={reasoning}
              models={models}
              onModelChange={setModel}
              onReasoningChange={setReasoning}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => handleSend()}
              disabled={!canSend}
              loading={streaming}
            >
              发送
            </Button>
          </div>
        </div>
      </div>
      <Suspense fallback={null}>
        <LocalFilePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(path, size) => {
            const previousPath = attachments[0]?.path;
            if (previousPath && previousPath !== path) {
              clearTaskInput(previousPath);
            }
            // 手动选择文件视为“为全新任务做准备”：清掉该路径的历史绑定。
            clearTaskInput(path);
            const file = {
              name: pathBasename(path),
              path,
              size: size ?? 0,
              source: 'agent' as const,
            };
            setConversationFile(conversationId, {
              name: file.name,
              path: file.path,
              size: file.size,
            });
            setLocalPaths([file]);
            setPickerOpen(false);
          }}
        />
      </Suspense>
    </section>
  );
}
