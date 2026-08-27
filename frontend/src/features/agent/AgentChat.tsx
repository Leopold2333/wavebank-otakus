import { startTransition, Suspense, useEffect, useRef, useState } from 'react';
import { App, Button, Collapse, Input, Spin, Tag, Tooltip } from 'antd';
import {
  EditOutlined,
  FolderOpenOutlined,
  RobotOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  getAgentModels,
  getAgentConversationMessages,
  getTask,
  rollbackAgentConversation,
  streamAgentChat,
  type AgentChatFile,
  type AgentMessage,
  type AgentModelInfo,
  type TaskRecord,
} from '../../api/client';
import { AttachmentList } from '../files/AttachmentList';
import { useFileAttachments } from '../files/FileAttachmentsContext';
import { LocalFilePicker } from '../files/LocalFilePickerLazy';
import { useTaskCacheStore } from '../../store/taskCache';
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
  /** Agent 工具生成输出文件后通知外层预览 */
  onTaskOutput?: (
    outputFile: { path: string; ts: number },
    task?: TaskRecord | null,
  ) => void;
  /** Agent 创建的后台任务进入运行态时通知外层（用于展示进度占位） */
  onTaskStart?: (taskId: string) => void;
  /** 会话回溯后通知外层清理当前分支预览 */
  onRollback?: () => void;
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
  const mapped = (toolCalls ?? []).map((call) => {
    let args: Record<string, unknown> = {};
    if (call.arguments && typeof call.arguments === 'object') {
      args = call.arguments as Record<string, unknown>;
    } else if (typeof call.arguments === 'string') {
      try {
        const parsed = JSON.parse(call.arguments) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        // 参数不是合法 JSON 时保留为空，避免展开时崩溃
      }
    }
    return {
      id: call.id,
      name: call.name,
      arguments: args,
      result: call.result,
    };
  });
  return mapped.length > 0 ? mapped : undefined;
}

function fromAgentMessage(item: AgentMessage): ChatMessage {
  const message = createMessage(
    item.role as ChatMessage['role'],
    item.content,
    undefined,
    item.files,
    toChatToolCalls(item.tool_calls),
  );
  return {
    ...message,
    id: item.id,
    ts: new Date(item.created_at).getTime() || message.ts,
  };
}

type TaskToolResult = {
  task_id?: string;
  status?: string;
  target_path?: string | null;
  outputs?: Array<{ path?: string }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getTaskToolResult(call: AgentToolCall): TaskToolResult | null {
  const result = asRecord(call.result);
  if (!result || typeof result.task_id !== 'string') {
    return null;
  }
  return result as TaskToolResult;
}

function formatToolValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value, null, 2) ?? String(value);
}

function ToolCallArguments({ args }: { args?: Record<string, unknown> }) {
  const entries = Object.entries(args ?? {});
  if (entries.length === 0) {
    return <div className="message__tool-empty">无参数</div>;
  }
  return (
    <dl className="message__tool-params">
      {entries.map(([name, value]) => (
        <div className="message__tool-param" key={name}>
          <dt className="message__tool-param-name">{name}</dt>
          <dd className="message__tool-param-value">{formatToolValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ToolCallResult({ result }: { result?: unknown }) {
  if (result === undefined) {
    return null;
  }
  const text =
    typeof result === 'string'
      ? result
      : JSON.stringify(result, null, 2) ?? String(result);
  return <pre className="message__tool-result">{text}</pre>;
}

function getToolCallSummary(call: AgentToolCall): string {
  const result = asRecord(call.result);
  if (typeof result?.task_id === 'string') {
    return `任务 ${result.task_id.slice(0, 8)}${
      result.status ? ` · ${result.status}` : ''
    }`;
  }
  if (typeof result?.error === 'string') {
    return result.error;
  }
  const args = call.arguments ?? {};
  if (Object.keys(args).length > 0) {
    return JSON.stringify(args);
  }
  if (result && Object.keys(result).length > 0) {
    return JSON.stringify(result);
  }
  return '已调用';
}

function latestUserFile(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const file = messages[index].files?.[0];
    if (messages[index].role === 'user' && file) {
      return file;
    }
  }
  return null;
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
  onTaskOutput,
  onTaskStart,
  onRollback,
}: AgentChatProps) {
  const { message: appMessage, modal } = App.useApp();
  const { attachments, setLocalPaths, removeAttachment } = useFileAttachments();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [models, setModels] = useState<AgentModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const latestStreamingMessageIdRef = useRef<string | null>(null);
  const pendingUserMessageIdRef = useRef<string | null>(null);
  const taskPollersRef = useRef<Record<string, number>>({});
  const shownTaskOutputsRef = useRef<Set<string>>(new Set());
  const onTaskOutputRef = useRef(onTaskOutput);
  const onTaskStartRef = useRef(onTaskStart);
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
  const conversationLoading = useAgentConversationStore(
    (state) => state.conversationLoading,
  );
  const setConversationLoading = useAgentConversationStore(
    (state) => state.setConversationLoading,
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

  const clearTaskInput = useTaskCacheStore((state) => state.clearInput);

  const displayMessages = messages.length > 0 ? messages : INITIAL_MESSAGES;

  function publishTaskOutput(task: TaskRecord) {
    const outputPath = task.target_path || task.outputs.at(-1)?.path;
    if (!outputPath || shownTaskOutputsRef.current.has(task.id)) {
      return;
    }
    shownTaskOutputsRef.current.add(task.id);
    onTaskOutputRef.current?.({ path: outputPath, ts: Date.now() }, task);
  }

  function stopTaskPolling(taskId: string) {
    const timer = taskPollersRef.current[taskId];
    if (timer) {
      window.clearInterval(timer);
      delete taskPollersRef.current[taskId];
    }
  }

  async function pollTaskOutput(taskId: string, fallback?: TaskToolResult) {
    try {
      const task = await getTask(taskId);
      if (task.status === 'completed') {
        publishTaskOutput(task);
        stopTaskPolling(taskId);
      } else if (task.status === 'failed' || task.status === 'cancelled') {
        stopTaskPolling(taskId);
      }
    } catch {
      const outputPath = fallback?.target_path || fallback?.outputs?.at(-1)?.path;
      if (fallback?.status === 'completed' && outputPath) {
        shownTaskOutputsRef.current.add(taskId);
        onTaskOutputRef.current?.({ path: outputPath, ts: Date.now() }, null);
      }
      stopTaskPolling(taskId);
    }
  }

  function watchTaskOutput(taskId: string, fallback?: TaskToolResult) {
    if (!taskId || shownTaskOutputsRef.current.has(taskId)) {
      return;
    }
    onTaskStartRef.current?.(taskId);
    if (!taskPollersRef.current[taskId]) {
      taskPollersRef.current[taskId] = window.setInterval(() => {
        void pollTaskOutput(taskId, fallback);
      }, 1000);
    }
    void pollTaskOutput(taskId, fallback);
  }

  function watchMessageTaskOutputs(nextMessages: ChatMessage[]) {
    let latestTaskId = '';
    let latestResult: TaskToolResult | undefined;
    for (const nextMessage of nextMessages) {
      for (const call of nextMessage.toolCalls ?? []) {
        const result = getTaskToolResult(call);
        if (result?.task_id) {
          latestTaskId = result.task_id;
          latestResult = result;
        }
      }
    }
    if (latestTaskId) {
      watchTaskOutput(latestTaskId, latestResult);
    }
  }

  function resetTaskOutputWatchers() {
    Object.values(taskPollersRef.current).forEach(window.clearInterval);
    taskPollersRef.current = {};
    shownTaskOutputsRef.current = new Set();
  }

  useEffect(() => {
    onTaskOutputRef.current = onTaskOutput;
  }, [onTaskOutput]);

  useEffect(() => {
    resetTaskOutputWatchers();
  }, [conversationId]);

  useEffect(
    () => () => {
      Object.values(taskPollersRef.current).forEach(window.clearInterval);
      taskPollersRef.current = {};
      setConversationLoading(false);
    },
    [setConversationLoading],
  );

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
      setConversationLoading(false);
      return;
    }
    if (streamErrorRef.current) {
      streamErrorRef.current = false;
      setConversationLoading(false);
      return;
    }
    if (useAgentConversationStore.getState().messages.length === 0) {
      setConversationLoading(true);
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
          setConversationLoading(false);
          return;
        }
        const restored = serverMessages
          .filter((item) => item.role === 'user' || item.role === 'assistant')
          .map((item) => fromAgentMessage(item));
        // 服务端有消息时以后端为准；服务端为空时保留本地乐观消息，
        // 避免覆盖刚发出的尚未落库的消息。
        const shouldReplace =
          restored.length > 0 ||
          useAgentConversationStore.getState().messages.length === 0;
        startTransition(() => {
          if (shouldReplace) {
            setMessages(restored);
          }
          setConversationLoading(false);
        });
        const file = latestUserFile(restored);
        if (file) {
          setConversationFile(conversationId, {
            name: file.name,
            path: file.path,
            size: file.size,
          });
          setLocalPaths([{ ...file, source: 'agent' }]);
        }
        watchMessageTaskOutputs(restored);
      } catch (error) {
        if (!cancelled) {
          if ((error as { status?: number }).status === 404) {
            resetConversation();
          }
          setConversationLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    conversationId,
    resetConversation,
    setConversationLoading,
    setConversationFile,
    setLocalPaths,
    setMessages,
  ]);

  const handleSend = (raw?: string) => {
    const text = (raw ?? draft).trim();
    const files: AgentChatFile[] = attachments.map(({ id, name, size, path }) => ({
      id,
      name,
      size,
      path,
    }));
    if ((!text && files.length === 0) || streaming || conversationLoading) {
      return;
    }

    const effectiveConversationId = conversationId ?? undefined;
    const userMessage = createMessage('user', text, undefined, files);
    pendingUserMessageIdRef.current = userMessage.id;
    appendMessage(userMessage);
    setDraft('');
    onIntentResolved(resolveIntent(text));

    latestStreamingMessageIdRef.current = null;
    setStreaming(true);

    const ensureAssistantMessage = (messageId: string) => {
      const state = useAgentConversationStore.getState();
      if (!state.messages.some((message) => message.id === messageId)) {
        appendMessage({ ...createMessage('assistant', ''), id: messageId });
      }
      latestStreamingMessageIdRef.current = messageId;
      setStreamingMessageId(messageId);
    };

    void streamAgentChat(
      {
        conversation_id: effectiveConversationId ?? undefined,
        content: text,
        intent: activeIntent,
        subtype: activeSubtype,
        files,
        model: model || undefined,
        reasoning_effort: reasoning === 'off' ? '' : reasoning,
        thinking: reasoning !== 'off',
      },
      {
        onMeta: (newConversationId, userMessageId) => {
          if (newConversationId) {
            bindPendingFile(newConversationId);
            setConversation(newConversationId);
            onConversationCreated?.(newConversationId);
            onConversationActivity?.();
          }
          if (userMessageId && pendingUserMessageIdRef.current) {
            updateMessage(pendingUserMessageIdRef.current, { id: userMessageId });
            pendingUserMessageIdRef.current = null;
          }
        },
        onMessageStart: ({ id }) => {
          ensureAssistantMessage(id);
        },
        onDelta: (messageId, delta) => {
          ensureAssistantMessage(messageId);
          const state = useAgentConversationStore.getState();
          const current =
            state.messages.find((message) => message.id === messageId)?.content ?? '';
          updateMessage(messageId, { content: current + delta });
        },
        onToolCall: (toolCall) => {
          const messageId =
            toolCall.message_id ?? latestStreamingMessageIdRef.current ?? crypto.randomUUID();
          ensureAssistantMessage(messageId);
          const state = useAgentConversationStore.getState();
          const currentToolCalls =
            state.messages.find((message) => message.id === messageId)?.toolCalls ?? [];
          updateMessage(messageId, { toolCalls: [...currentToolCalls, toolCall] });
          const result = getTaskToolResult(toolCall);
          if (result?.task_id) {
            watchTaskOutput(result.task_id, result);
          }
        },
        onDone: (finalMessage) => {
          const finalToolCalls = toChatToolCalls(finalMessage.tool_calls);
          finalToolCalls?.forEach((call) => {
            const result = getTaskToolResult(call);
            if (result?.task_id) {
              watchTaskOutput(result.task_id, result);
            }
          });
          ensureAssistantMessage(finalMessage.id);
          const state = useAgentConversationStore.getState();
          const current =
            state.messages.find((message) => message.id === finalMessage.id)?.content ?? '';
          const patch: Partial<ChatMessage> = {
            content: finalMessage.content || current,
          };
          if (finalToolCalls) {
            patch.toolCalls = finalToolCalls;
          }
          if (state.messages.some((message) => message.id === finalMessage.id)) {
            updateMessage(finalMessage.id, patch);
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
          latestStreamingMessageIdRef.current = null;
          pendingUserMessageIdRef.current = null;
          onConversationActivity?.();
        },
        onError: (error) => {
          const messageId = latestStreamingMessageIdRef.current ?? crypto.randomUUID();
          ensureAssistantMessage(messageId);
          streamErrorRef.current = true;
          updateMessage(messageId, {
            content: `⚠️ ${error}`,
          });
          setStreamingMessageId(null);
          setStreaming(false);
          latestStreamingMessageIdRef.current = null;
          pendingUserMessageIdRef.current = null;
        },
      },
    ).catch((error: unknown) => {
      const messageId = latestStreamingMessageIdRef.current ?? crypto.randomUUID();
      ensureAssistantMessage(messageId);
      streamErrorRef.current = true;
      updateMessage(messageId, {
        content: `⚠️ ${error instanceof Error ? error.message : '流式连接中断'}`,
      });
      setStreamingMessageId(null);
      setStreaming(false);
      latestStreamingMessageIdRef.current = null;
      pendingUserMessageIdRef.current = null;
    });
  };

  const focusComposer = () => {
    window.setTimeout(() => {
      composerRef.current?.querySelector('textarea')?.focus();
    }, 0);
  };

  const applyRollback = async (target: ChatMessage, index: number) => {
    if (streaming || target.role !== 'user') {
      return;
    }
    try {
      if (conversationId) {
        const response = await rollbackAgentConversation(conversationId, target.id);
        const restored = response.messages
          .filter((item) => item.role === 'user' || item.role === 'assistant')
          .map((item) => fromAgentMessage(item));
        resetTaskOutputWatchers();
        setMessages(restored);
        watchMessageTaskOutputs(restored);
      } else {
        resetTaskOutputWatchers();
        setMessages(messages.slice(0, index));
      }
      setDraft(target.content);
      const file = target.files?.[0] ?? null;
      setLocalPaths(file ? [{ ...file, source: 'agent' }] : []);
      setConversationFile(
        conversationId,
        file
          ? {
              name: file.name,
              path: file.path,
              size: file.size,
            }
          : null,
      );
      onRollback?.();
      onConversationActivity?.();
      focusComposer();
    } catch (error) {
      appMessage.error(error instanceof Error ? error.message : '回溯失败');
    }
  };

  const handleRollback = (target: ChatMessage, index: number) => {
    if (streaming || target.role !== 'user') {
      return;
    }
    modal.confirm({
      title: '确认回溯到这条问题？',
      content: '确认后会删除这条问题及其之后的对话，并清理对应的任务记录。',
      okText: '确认回溯',
      cancelText: '取消',
      okType: 'danger',
      onOk: () => applyRollback(target, index),
    });
  };

  const currentIntent = activeIntent ? INTENT_MAP[activeIntent] : null;
  const currentSubtype = activeSubtype ? getAudioSubtype(activeSubtype) : null;
  const canSend =
    !streaming &&
    !conversationLoading &&
    (draft.trim().length > 0 || attachments.length > 0);

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

      <Spin
        spinning={conversationLoading}
        description="正在加载会话…"
        size="large"
        rootClassName="agent-chat__spin"
      >
        <div className="agent-chat__messages">
          {displayMessages.map((message, index) => (
            <div key={message.id} className={`message message--${message.role}`}>
              <div className="message__body">
                {message.content ||
                  (streaming && message.id === displayMessages.at(-1)?.id
                    ? message.toolCalls && message.toolCalls.length > 0
                      ? '正在调用工具…'
                      : '正在思考…'
                    : '')}
              </div>
              {message.role === 'user' && messages.some((item) => item.id === message.id) ? (
                <div className="message__actions">
                  <Tooltip title="回到这里编辑">
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      disabled={streaming}
                      aria-label="回到这里编辑"
                      onClick={() => handleRollback(message, index)}
                    />
                  </Tooltip>
                </div>
              ) : null}
              {message.toolCalls && message.toolCalls.length > 0 ? (
                <div className="message__tools">
                  <Collapse
                    ghost
                    size="small"
                    bordered={false}
                    expandIconPlacement="end"
                    className="message__tools-collapse"
                    items={message.toolCalls.map((call, index) => ({
                      key: call.id || `${message.id}:${index}`,
                      label: (
                        <span className="message__tool-header">
                          <span className="message__tool-name">{call.name}</span>
                          <span className="message__tool-summary">
                            {getToolCallSummary(call)}
                          </span>
                        </span>
                      ),
                      children: (
                        <div className="message__tool-detail">
                          <div className="message__tool-section-title">参数填充</div>
                          <ToolCallArguments args={call.arguments} />
                          {call.result !== undefined ? (
                            <>
                              <div className="message__tool-section-title">
                                工具结果
                              </div>
                              <ToolCallResult result={call.result} />
                            </>
                          ) : null}
                        </div>
                      ),
                    }))}
                  />
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
      </Spin>

      <div className="agent-chat__quick">
        {QUICK_PROMPTS.map((prompt) => (
          <Button
            key={prompt}
            size="small"
            type="dashed"
            disabled={streaming || conversationLoading}
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

      <div className="agent-chat__composer" ref={composerRef}>
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
