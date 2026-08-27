import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  App,
  Button,
  Card,
  Descriptions,
  Flex,
  Popconfirm,
  Progress,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  type DescriptionsProps,
  type TableColumnsType,
} from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  cancelTask,
  deleteTask,
  getTasks,
  type AudioTaskParams,
  type TaskRecord,
} from '../api/client';
import { useTaskCacheStore } from '../store/taskCache';
import { formatFileSize } from '../utils/format';

const STATUS_META: Record<TaskRecord['status'], { color: string; label: string }> = {
  pending: { color: 'default', label: '排队中' },
  running: { color: 'processing', label: '处理中' },
  cancelling: { color: 'warning', label: '取消中' },
  completed: { color: 'success', label: '已完成' },
  failed: { color: 'error', label: '失败' },
  cancelled: { color: 'default', label: '已取消' },
};

const TERMINAL_TASK_STATUSES: TaskRecord['status'][] = [
  'completed',
  'failed',
  'cancelled',
];

type TaskCenterScope = 'pipeline' | 'operations';

const TASK_CENTER_SCOPES: Array<{
  key: TaskCenterScope;
  label: string;
  description: string;
}> = [
  {
    key: 'pipeline',
    label: 'Pipeline 任务',
    description: '查看一个任务 ID 下串联多步音频处理的编排任务',
  },
  {
    key: 'operations',
    label: '单操作任务',
    description: '查看格式转换、裁切、变调、降噪等单次操作任务',
  },
];

function getTaskCenterScope(pathname: string): TaskCenterScope {
  return pathname.startsWith('/tasks/operations') ? 'operations' : 'pipeline';
}

function isPipelineTask(task: TaskRecord) {
  return task.type === 'audio.pipeline';
}

function formatParams(params: AudioTaskParams, taskType?: string) {
  if (taskType === 'agent.chat') {
    return 'Agent 对话';
  }
  if (taskType === 'audio.pipeline') {
    const steps = (params.steps ?? [])
      .map((step) => step.taskType ?? step.task_type ?? step.type ?? step.subtype)
      .filter(Boolean)
      .map((step) => String(step).replace(/^audio\./, ''));
    return steps.length > 0
      ? `Pipeline：${steps.join(' → ')}${params.outputFormat ? ` → ${params.outputFormat}` : ''}`
      : '音频编排';
  }
  const parts = [
    params.outputFormat ? `→ ${params.outputFormat}` : '',
    params.outputFileName ? `文件名 ${params.outputFileName}` : '',
    params.volumeGain ? `${params.volumeGain} dB` : '',
    params.loudnessTarget ? `${params.loudnessTarget} LUFS` : '',
    params.channels ? `${params.channels}ch` : '',
    params.sampleRate ? `${params.sampleRate} Hz` : '',
    params.bitrate ? params.bitrate : '',
    params.audioTrack ? `音轨 ${params.audioTrack}` : '',
    params.startTime != null ? `从 ${params.startTime}s 起` : '',
    params.duration != null ? `裁 ${params.duration}s` : '',
    params.pitchSemitones ? `变调 ${params.pitchSemitones}` : '',
    params.speed && params.speed !== 1 ? `${params.speed}x` : '',
    params.denoiseStrength != null ? `降噪 ${params.denoiseStrength}` : '',
    params.modelName
      ? `模型 ${String(params.modelName).replace(/\.(ckpt|th|pt|yaml)$/i, '')}`
      : '',
    params.device && params.device !== 'auto' ? `设备 ${String(params.device).toUpperCase()}` : '',
    params.useTta ? 'TTA' : '',
    params.batchSize != null ? `批 ${params.batchSize}` : '',
    params.overlapSize != null ? `重叠 ${params.overlapSize}` : '',
    params.chunkSize != null ? `分块 ${params.chunkSize}` : '',
    params.standardize ? '输入标准化' : '',
    params.normalize ? '输出归一化' : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : params.inputFile;
}

function JsonBlock({ title, value }: { title: string; value?: Record<string, unknown> }) {
  return (
    <div className="task-center-page__block">
      <Typography.Text strong>{title}</Typography.Text>
      <pre>{JSON.stringify(value ?? {}, null, 2)}</pre>
    </div>
  );
}

export function TaskCenterPage() {
  const { message } = App.useApp();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const removeTaskCache = useTaskCacheStore((state) => state.removeTask);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);
  const activeScope = getTaskCenterScope(pathname);

  useEffect(() => {
    if (
      pathname === '/tasks' ||
      (pathname.startsWith('/tasks/') &&
        !pathname.startsWith('/tasks/pipeline') &&
        !pathname.startsWith('/tasks/operations'))
    ) {
      navigate(`/tasks/${activeScope}`, { replace: true });
    }
  }, [activeScope, navigate, pathname]);

  const load = useCallback(async () => {
    try {
      const response = await getTasks();
      setTasks(response.tasks);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载任务失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();

    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let retryDelay = 1000;

    const connect = () => {
      if (typeof EventSource === 'undefined') {
        liveRef.current = false;
        setLive(false);
        return;
      }
      source = new EventSource('/api/tasks/events');
      source.addEventListener('tasks.snapshot', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as { tasks: TaskRecord[] };
          setTasks(data.tasks);
          liveRef.current = true;
          setLive(true);
          retryDelay = 1000;
        } catch {
          // 忽略无法解析的快照，等待下一帧
        }
      });
      source.onerror = () => {
        source?.close();
        source = null;
        liveRef.current = false;
        setLive(false);
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
      };
    };

    connect();

    // SSE 正常时以推送为准；仅在断线 fallback 模式下轮询，避免双通道重复拉取。
    const timer = window.setInterval(() => {
      if (!liveRef.current) {
        void load();
      }
    }, 5000);
    return () => {
      source?.close();
      window.clearInterval(timer);
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [load]);

  const handleCancel = useCallback(
    async (taskId: string) => {
      try {
        await cancelTask(taskId);
        message.success('已发送取消请求');
        await load();
      } catch (error) {
        message.error(error instanceof Error ? error.message : '取消失败');
      }
    },
    [load, message],
  );

  const handleDelete = useCallback(
    async (taskId: string) => {
      try {
        await deleteTask(taskId);
        removeTaskCache(taskId);
        message.success('任务已删除');
        await load();
      } catch (error) {
        message.error(error instanceof Error ? error.message : '删除失败');
      }
    },
    [load, message, removeTaskCache],
  );

  const handleOpenResult = useCallback(
    (task: TaskRecord) => {
      if (!task.type.startsWith('audio.')) {
        message.info('该任务类型暂不支持直接进入结果');
        return;
      }
      if (task.type === 'audio.vocal_separation') {
        const separationOutput = task.target_path || task.outputs[0]?.path;
        if (!separationOutput) {
          message.warning('该任务没有可用的输出文件');
          return;
        }
        navigate('/separation', {
          state: {
            outputFile: { path: separationOutput, ts: Date.now() },
            taskId: task.id,
          },
        });
        return;
      }
      const subtype =
        task.type === 'audio' || task.type === 'audio.pipeline'
          ? 'convert'
          : task.type.split('.')[1];
      if (!subtype) {
        return;
      }
      const outputPath = task.target_path || task.outputs[0]?.path;
      if (!outputPath) {
        message.warning('该任务没有可用的输出文件');
        return;
      }
      navigate(`/audio/${subtype}`, {
        state: {
          outputFile: { path: outputPath, ts: Date.now() },
          taskId: task.id,
        },
      });
    },
    [message, navigate],
  );

  const columns = useMemo<TableColumnsType<TaskRecord>>(
    () => [
      {
        title: '任务',
        dataIndex: 'id',
        width: 320,
        render: (id: string, task) => (
          <Flex vertical gap={2}>
            <Typography.Text code className="task-center-page__task-id">
              {id}
            </Typography.Text>
            <Tag color={task.creation_mode === 'rebuild' ? 'purple' : 'blue'}>
              {task.creation_mode === 'rebuild' ? '重构输出' : '新建任务'}
            </Tag>
            {task.conversation_id ? (
              <Tag color="cyan" title={task.conversation_id}>
                会话 {task.conversation_id.slice(0, 8)}
              </Tag>
            ) : null}
          </Flex>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 110,
        render: (status: TaskRecord['status']) => (
          <Tag color={STATUS_META[status].color}>{STATUS_META[status].label}</Tag>
        ),
      },
      {
        title: '进度',
        dataIndex: 'progress',
        width: 180,
        render: (progress: number, task) => (
          <Flex vertical gap={2}>
            <Progress
              percent={Math.round(progress)}
              size="small"
              status={
                task.status === 'failed'
                  ? 'exception'
                  : task.status === 'completed'
                    ? 'success'
                    : 'active'
              }
            />
            {task.stage && !TERMINAL_TASK_STATUSES.includes(task.status) ? (
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, lineHeight: '16px' }}
                ellipsis={{ tooltip: task.stage }}
              >
                {task.stage}
              </Typography.Text>
            ) : null}
          </Flex>
        ),
      },
      {
        title: '参数',
        dataIndex: 'params',
        ellipsis: true,
        render: (params: AudioTaskParams, task) => formatParams(params, task.type),
      },
      {
        title: '创建时间',
        dataIndex: 'created_at',
        width: 190,
        render: (value: string) => new Date(value).toLocaleString(),
      },
      {
        title: '操作',
        width: 92,
        align: 'center',
        render: (_, task) => (
          <Space direction="vertical" size={4} className="task-center-page__actions">
            {task.status === 'running' || task.status === 'pending' ? (
              <Button size="small" danger block onClick={() => void handleCancel(task.id)}>
                取消
              </Button>
            ) : null}
            {task.status === 'completed' ||
            task.status === 'failed' ||
            task.status === 'cancelled' ? (
              <>
                {task.status === 'completed' ? (
                  <Button size="small" type="link" block onClick={() => handleOpenResult(task)}>
                    进入结果
                  </Button>
                ) : null}
                <Popconfirm
                  title="删除任务"
                  description="将删除任务记录、任务内对话记录与任务目录中的输出文件；Agent 独立会话不受影响。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void handleDelete(task.id)}
                >
                  <Button size="small" type="link" danger block>
                    删除
                  </Button>
                </Popconfirm>
              </>
            ) : null}
          </Space>
        ),
      },
    ],
    [handleCancel, handleDelete, handleOpenResult],
  );

  const taskCounts = useMemo(
    () => ({
      pipeline: tasks.filter(isPipelineTask).length,
      operations: tasks.filter((task) => !isPipelineTask(task)).length,
    }),
    [tasks],
  );
  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) =>
        activeScope === 'pipeline' ? isPipelineTask(task) : !isPipelineTask(task),
      ),
    [activeScope, tasks],
  );
  const activeScopeMeta =
    TASK_CENTER_SCOPES.find((item) => item.key === activeScope) ?? TASK_CENTER_SCOPES[0];

  return (
    <Card
      className="task-center-page"
      title="任务中心"
      extra={<Tag color={live ? 'processing' : 'default'}>{live ? '实时连接' : '轮询模式'}</Tag>}
    >
      <div className="task-center-page__toolbar">
        <Segmented
          value={activeScope}
          options={TASK_CENTER_SCOPES.map((scope) => ({
            value: scope.key,
            label: `${scope.label} ${
              scope.key === 'pipeline' ? taskCounts.pipeline : taskCounts.operations
            }`,
          }))}
          onChange={(value) => navigate(`/tasks/${value}`)}
        />
        <Typography.Text type="secondary">{activeScopeMeta.description}</Typography.Text>
      </div>
      <Table<TaskRecord>
        rowKey="id"
        loading={loading}
        dataSource={visibleTasks}
        locale={{ emptyText: `暂无${activeScopeMeta.label}` }}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        expandable={{
          expandedRowRender: (task) => {
            const summaryItems: DescriptionsProps['items'] = [
              { key: 'type', label: '任务类型', children: task.type },
              {
                key: 'status',
                label: '状态',
                children: STATUS_META[task.status].label,
              },
              {
                key: 'tmp_dir',
                label: '任务目录',
                children: task.tmp_dir || '未创建',
              },
              {
                key: 'target',
                label: '目标输出',
                children: task.target_path || '尚未生成',
              },
            ];
            return (
              <div className="task-center-page__detail">
                <Descriptions size="small" column={2} items={summaryItems} />
                <div className="task-center-page__json-grid">
                  <JsonBlock title="输入参数" value={task.input_params} />
                  <JsonBlock title="输出参数" value={task.output_params} />
                  <JsonBlock title="配置参数" value={task.config} />
                </div>
                <Typography.Text strong>执行命令</Typography.Text>
                <pre>{task.command ? task.command.join(' ') : '尚未生成'}</pre>
                {task.error ? (
                  <>
                    <Typography.Text type="danger">错误信息</Typography.Text>
                    <pre>{task.error}</pre>
                  </>
                ) : null}
                <Typography.Text strong>日志</Typography.Text>
                <pre>{task.logs.length ? task.logs.join('\n') : '暂无日志'}</pre>
                {task.outputs.length ? (
                  <>
                    <Typography.Text strong>产物</Typography.Text>
                    {task.outputs.map((output) => (
                      <div key={output.path} className="task-center-page__output">
                        {output.step ? <Tag>Step {output.step}</Tag> : null}
                        {output.task_type ? <Tag>{output.task_type}</Tag> : null}
                        {output.stem ? (
                          <Tag color={output.stem === 'vocals' ? 'green' : 'blue'}>
                            {output.stem === 'vocals' ? '人声' : '伴奏'}
                          </Tag>
                        ) : null}
                        {output.path}（{formatFileSize(output.size)}）
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            );
          },
        }}
        columns={columns}
      />
    </Card>
  );
}
