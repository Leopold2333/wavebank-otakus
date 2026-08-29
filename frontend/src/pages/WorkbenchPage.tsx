import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { deleteAgentConversation, getTask, type TaskRecord } from '../api/client';
import { AgentChat } from '../features/agent/AgentChat';
import { AgentConversationSidebar } from '../features/agent/AgentConversationSidebar';
import { AudioFilePanel } from '../features/audio/AudioFilePanel';
import { useFileAttachments } from '../features/files/FileAttachmentsContext';
import { ParamWindow } from '../features/params/ParamWindow';
import {
  DEFAULT_AUDIO_SUBTYPE,
  isAudioSubtypeId,
  taskTypeForIntent,
  type AudioSubtypeId,
} from '../features/params/audioSubtypes';
import { isIntentId } from '../features/params/intentRegistry';
import {
  selectConversationFile,
  useAgentConversationStore,
} from '../store/agentConversation';
import {
  entryOutputFiles,
  selectLatestOutputEntryByInput,
  useTaskCacheStore,
  type TaskOutputFile,
} from '../store/taskCache';
import type { IntentId } from '../types';
import { pathBasename } from '../utils/format';

/** 从任务记录提取输出列表：人声分离/含 stem 的编排任务返回全部音轨，其余返回主输出 */
function extractTaskOutputs(task: TaskRecord): TaskOutputFile[] {
  const outputs = task.outputs ?? [];
  if (
    task.type === 'audio.vocal_separation' ||
    outputs.some((output) => output.stem)
  ) {
    return outputs.map((output) => ({ path: output.path, stem: output.stem }));
  }
  return task.target_path ? [{ path: task.target_path }] : [];
}

export function WorkbenchPage() {
  const { message } = App.useApp();
  const { pathname, state: locationState } = useLocation();
  const navigate = useNavigate();
  const segments = pathname.split('/').filter(Boolean);
  const activeIntent = isIntentId(segments[0]) ? segments[0] : null;
  const activeSubtype =
    activeIntent === 'audio' && isAudioSubtypeId(segments[1]) ? segments[1] : null;
  const activeTaskType = activeIntent
    ? taskTypeForIntent(activeIntent, activeSubtype ?? undefined)
    : undefined;
  const urlConversationId =
    segments[0] === 'chat' && segments[1] ? segments[1] : null;
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskPending, setTaskPending] = useState(false);
  const [pendingMode, setPendingMode] = useState<'new' | 'rebuild' | null>(null);
  const [restoreRequest, setRestoreRequest] = useState<{
    taskId: string;
    token: number;
  } | null>(null);
  const [agentRefreshKey, setAgentRefreshKey] = useState(0);
  const [chatIntent, setChatIntent] = useState<IntentId | null>(null);
  const [agentOutputFiles, setAgentOutputFiles] = useState<TaskOutputFile[] | null>(
    null,
  );
  const [agentActiveTaskId, setAgentActiveTaskId] = useState<string | null>(null);
  const { attachments, setLocalPaths } = useFileAttachments();
  const inputPath = attachments[0]?.path;
  const conversationId = useAgentConversationStore((state) => state.conversationId);
  const conversationLoading = useAgentConversationStore(
    (state) => state.conversationLoading,
  );
  const setConversation = useAgentConversationStore((state) => state.setConversation);
  const setConversationLoading = useAgentConversationStore(
    (state) => state.setConversationLoading,
  );
  const discardConversationCache = useAgentConversationStore(
    (state) => state.discardConversationCache,
  );
  const abortStream = useAgentConversationStore((state) => state.abortStream);
  const resetConversation = useAgentConversationStore((state) => state.reset);
  const setConversationFile = useAgentConversationStore(
    (state) => state.setConversationFile,
  );
  const cachedOutputEntry = useTaskCacheStore((state) =>
    selectLatestOutputEntryByInput(state, inputPath, activeTaskType),
  );
  const cachedOutputFiles = useMemo(
    () => entryOutputFiles(cachedOutputEntry),
    [cachedOutputEntry],
  );
  const restoreTask = useTaskCacheStore((state) => state.restoreTask);
  const updateOutput = useTaskCacheStore((state) => state.updateOutput);
  const clearAllCache = useTaskCacheStore((state) => state.clearAll);
  const outputFiles = activeIntent ? cachedOutputFiles : agentOutputFiles;
  /** 防止同一轮进入工作台时重复清理附件 */
  const workbenchEnteredRef = useRef(false);
  /** 最近一次路由键（chat / chat:id / intent:xxx），用于 URL 切换时重置会话 */
  const lastRouteKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeIntent) {
      workbenchEnteredRef.current = false;
      return;
    }
    if (workbenchEnteredRef.current) {
      return;
    }
    workbenchEnteredRef.current = true;
    // 进入 Agent 工作台：解除人工参数任务输入文件的渲染（任务缓存保留）。
    // 如果当前会话自己附加过文件，则恢复该会话的文件而不是清空。
    const conversationFile = selectConversationFile(
      useAgentConversationStore.getState(),
      urlConversationId ?? conversationId,
    );
    if (conversationFile) {
      setLocalPaths([
        {
          name: conversationFile.name,
          path: conversationFile.path,
          size: conversationFile.size,
          source: 'agent',
        },
      ]);
    } else if (attachments.length > 0) {
      setLocalPaths([]);
    }
  }, [activeIntent, attachments, conversationId, urlConversationId, setLocalPaths]);

  // URL 未携带会话 ID（/chat）时，始终作为“新建会话”入口：
  // 清空当前会话状态，历史会话通过左侧会话列表手动进入。
  useEffect(() => {
    const routeKey = urlConversationId
      ? `chat:${urlConversationId}`
      : activeIntent
        ? `intent:${activeIntent}`
        : 'chat';
    if (lastRouteKeyRef.current === routeKey) {
      return;
    }
    lastRouteKeyRef.current = routeKey;
    if (!activeIntent && !urlConversationId) {
      abortStream();
      const state = useAgentConversationStore.getState();
      if (state.conversationId || state.messages.length > 0) {
        resetConversation();
      }
      setLocalPaths([]);
      setAgentOutputFiles(null);
      setAgentActiveTaskId(null);
      setConversationLoading(false);
    } else if (activeIntent) {
      // 进入人工参数页时清掉可能残留的会话加载状态，避免切回后一直转圈。
      setConversationLoading(false);
    }
  }, [
    abortStream,
    activeIntent,
    resetConversation,
    setConversationLoading,
    setLocalPaths,
    urlConversationId,
  ]);

  // 从任何功能页切出（或卸载）时清空任务缓存与输入文件：
  // 缓存只在从任务记录跳转回来时通过 restoreTask 重新写入。
  useEffect(() => {
    const isFeaturePage = Boolean(activeIntent);
    return () => {
      if (isFeaturePage) {
        clearAllCache();
        setLocalPaths([]);
      }
    };
  }, [activeIntent, activeSubtype, clearAllCache, setLocalPaths]);

  // 进入人工参数页时，清掉属于 Agent 会话的附件（会话缓存仍保留，
  // 切回会话时会重新写回）；人工参数页自己选择的文件不受影响。
  useEffect(() => {
    if (!activeIntent) {
      return;
    }
    if (attachments[0]?.source === 'agent') {
      setLocalPaths([]);
    }
  }, [activeIntent, attachments, setLocalPaths]);

  // URL 携带会话 ID（/chat/:id）时加载对应会话；也覆盖“页面直接打开该 URL”的情况。
  useEffect(() => {
    if (!urlConversationId || urlConversationId === conversationId) {
      return;
    }
    if (useAgentConversationStore.getState().streaming) {
      return;
    }
    setAgentOutputFiles(null);
    setAgentActiveTaskId(null);
    setConversation(urlConversationId);
    setConversationLoading(true);
    const conversationFile =
      useAgentConversationStore.getState().files[urlConversationId] ?? null;
    setLocalPaths(
      conversationFile
        ? [
            {
              name: conversationFile.name,
              path: conversationFile.path,
              size: conversationFile.size,
              source: 'agent',
            },
          ]
        : [],
    );
  }, [
    urlConversationId,
    conversationId,
    setConversation,
    setConversationLoading,
    setLocalPaths,
  ]);

  useEffect(() => {
    const resultState = locationState as {
      outputFile?: { path: string; ts?: number };
      taskId?: string;
    } | null;
    const taskId = resultState?.taskId;
    if (!taskId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const task = await getTask(taskId);
        if (cancelled) {
          return;
        }
        const seed = (
          task.config as
            | { runtime?: { task_seed?: { timestamp?: number } } }
            | undefined
        )?.runtime?.task_seed;
        const inputFile =
          (task.params.inputFile as string | undefined) ??
          (task.input_params?.inputFile as string | undefined) ??
          '';
        if (inputFile) {
          setLocalPaths([
            {
              name: pathBasename(inputFile),
              path: inputFile,
              size: 0,
              source: 'manual',
            },
          ]);
        }
        restoreTask(taskId, {
          taskType: task.type,
          inputFile,
          timestamp: seed?.timestamp ?? Date.now(),
          params: task.params,
          outputFile: task.target_path
            ? { path: task.target_path, ts: Date.now() }
            : null,
          outputFiles: extractTaskOutputs(task).map((file) => ({
            ...file,
            ts: Date.now(),
          })),
        });
        setRestoreRequest((prev) => ({ taskId, token: (prev?.token ?? 0) + 1 }));
      } catch {
        // 任务已被删除等情况：保留输出文件展示即可
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locationState, restoreTask, setLocalPaths]);

  useEffect(() => {
    if (!activeTaskId) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const task = await getTask(activeTaskId);
        if (cancelled) {
          return;
        }
        if (task.status === 'completed') {
          if (task.target_path) {
            const taskOutputs = extractTaskOutputs(task).map((file) => ({
              ...file,
              ts: Date.now(),
            }));
            updateOutput(
              activeTaskId,
              { path: task.target_path, ts: Date.now() },
              taskOutputs,
            );
          }
          message.success('任务完成');
          setActiveTaskId(null);
          setTaskPending(false);
          setPendingMode(null);
          window.clearInterval(timer);
        } else if (task.status === 'failed' || task.status === 'cancelled') {
          if (task.status === 'failed') {
            message.error(task.error || '任务失败');
          } else {
            message.warning('任务已取消');
          }
          setActiveTaskId(null);
          setTaskPending(false);
          setPendingMode(null);
          window.clearInterval(timer);
        }
      } catch {
        // 拉取失败时等待下一轮
      }
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeTaskId, message, updateOutput]);

  const handleSelectIntent = (intent: IntentId | null) => {
    navigate(
      intent === 'audio' ? `/audio/${DEFAULT_AUDIO_SUBTYPE}` : intent ? `/${intent}` : '/chat',
    );
  };

  const handleSelectSubtype = (subtype: AudioSubtypeId) => {
    navigate(`/audio/${subtype}`);
  };

  const handleTaskCreated = (taskId: string, mode: 'new' | 'rebuild') => {
    setActiveTaskId(taskId);
    setTaskPending(true);
    setPendingMode(mode);
  };

  const handleAgentIntentResolved = (intent: IntentId) => {
    // Agent 工作台只做对话，不跳转到人工参数页；解析出的意图仅用于顶部标签展示
    setChatIntent(intent);
  };

  const handleSelectConversation = (selectedConversationId: string) => {
    if (selectedConversationId === conversationId) {
      return;
    }
    abortStream();
    setAgentOutputFiles(null);
    setAgentActiveTaskId(null);
    setConversation(selectedConversationId);
    setConversationLoading(true);
    navigate(`/chat/${selectedConversationId}`);
    const conversationFile =
      useAgentConversationStore.getState().files[selectedConversationId] ?? null;
    setLocalPaths(
      conversationFile
        ? [
            {
              name: conversationFile.name,
              path: conversationFile.path,
              size: conversationFile.size,
              source: 'agent',
            },
          ]
        : [],
    );
  };

  const handleNewConversation = () => {
    abortStream();
    resetConversation();
    setChatIntent(null);
    setLocalPaths([]);
    setAgentOutputFiles(null);
    setAgentActiveTaskId(null);
    setAgentRefreshKey((key) => key + 1);
    navigate('/chat', { state: { new: true } });
  };

  const handleDeleteConversation = async (selectedConversationId: string) => {
    try {
      await deleteAgentConversation(selectedConversationId);
      if (selectedConversationId === conversationId) {
        abortStream();
        resetConversation();
        setChatIntent(null);
        setLocalPaths([]);
        setAgentOutputFiles(null);
        setAgentActiveTaskId(null);
        navigate('/chat', { state: { new: true } });
      }
      discardConversationCache(selectedConversationId);
      setConversationFile(selectedConversationId, null);
      setAgentRefreshKey((key) => key + 1);
      message.success('会话已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除会话失败');
    }
  };

  const handleAgentTaskStart = useCallback((taskId: string) => {
    setAgentActiveTaskId(taskId);
  }, []);

  const handleAgentTaskOutput = useCallback(
    (nextOutputFile: { path: string; ts: number }, task?: TaskRecord | null) => {
      // 人声分离等任务携带多产物：优先展示完整输出列表
      const taskOutputs = task ? extractTaskOutputs(task) : [];
      setAgentOutputFiles(
        taskOutputs.length > 0
          ? taskOutputs.map((file) => ({ ...file, ts: nextOutputFile.ts }))
          : [nextOutputFile],
      );
      setAgentActiveTaskId(null);
      const inputFile =
        (task?.params.inputFile as string | undefined) ??
        (task?.input_params?.inputFile as string | undefined);
      if (!inputFile) {
        return;
      }
      const file = {
        name: pathBasename(inputFile),
        path: inputFile,
        size: 0,
        source: 'agent' as const,
      };
      setLocalPaths([file]);
      setConversationFile(task?.conversation_id ?? conversationId, {
        name: file.name,
        path: file.path,
        size: file.size,
      });
    },
    [conversationId, setConversationFile, setLocalPaths],
  );

  return (
    <div className="workbench">
      {activeIntent !== 'batch' ? (
        <AudioFilePanel
          outputs={outputFiles}
          activeTaskId={activeTaskId ?? agentActiveTaskId}
        />
      ) : null}
      {activeIntent ? (
        <ParamWindow
          activeIntent={activeIntent}
          activeSubtype={
            activeIntent === 'audio' ? (activeSubtype ?? DEFAULT_AUDIO_SUBTYPE) : null
          }
          onSelectIntent={handleSelectIntent}
          onSelectSubtype={handleSelectSubtype}
          onTaskCreated={handleTaskCreated}
          taskPending={taskPending}
          taskPendingMode={pendingMode}
          restoreTask={restoreRequest}
        />
      ) : (
        <div className="agent-workspace">
          <AgentConversationSidebar
            activeConversationId={conversationId}
            refreshKey={agentRefreshKey}
            disabled={conversationLoading}
            onSelect={handleSelectConversation}
            onNewConversation={handleNewConversation}
            onDelete={handleDeleteConversation}
          />
          <AgentChat
            activeIntent={chatIntent}
            activeSubtype={null}
            onIntentResolved={handleAgentIntentResolved}
            onTaskOutput={handleAgentTaskOutput}
            onTaskStart={handleAgentTaskStart}
            onRollback={() => {
              setAgentOutputFiles(null);
              setAgentActiveTaskId(null);
            }}
            onConversationActivity={() =>
              setAgentRefreshKey((key) => key + 1)
            }
            onConversationCreated={(id) => navigate(`/chat/${id}`, { replace: true })}
          />
        </div>
      )}
    </div>
  );
}
