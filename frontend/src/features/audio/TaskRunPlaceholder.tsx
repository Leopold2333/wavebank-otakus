import { useEffect, useRef } from 'react';
import { Progress, Typography } from 'antd';

/** 日志尾行展示数量 */
const TAIL_LINES = 8;

/** 占位组件所需的任务快照字段（TaskRecord 的子集） */
export interface TaskRunSnapshot {
  status?: string;
  progress?: number;
  stage?: string | null;
  logs?: string[];
}

/**
 * 任务运行时占位：与输出文件容器同款圆角矩形，
 * 内部展示 Spin + 实时进度（与任务中心同源 SSE 快照）+ 命令日志尾部滚动。
 */
export function TaskRunPlaceholder({ task }: { task: TaskRunSnapshot | null }) {
  const logTailRef = useRef<HTMLDivElement>(null);
  const logs = task?.logs ?? [];
  const tail = logs.slice(-TAIL_LINES);

  // 新日志追加时滚动到底部
  useEffect(() => {
    const node = logTailRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [tail.length, task?.progress]);

  const progress = task?.progress ?? 0;
  const stage = task?.stage ?? null;
  const status = task?.status ?? 'pending';
  const statusText =
    status === 'running'
      ? stage ?? '处理中'
      : status === 'pending'
        ? '排队中'
        : status === 'cancelling'
          ? '取消中'
          : stage ?? '处理中';

  return (
    <div className="task-run-placeholder">
      <div className="task-run-placeholder__header">
        <span className="task-run-placeholder__spinner" aria-hidden />
        <Typography.Text className="task-run-placeholder__title">
          任务处理中…
        </Typography.Text>
        <Typography.Text type="secondary" className="task-run-placeholder__status">
          {statusText}
        </Typography.Text>
      </div>
      <Progress
        percent={Math.round(progress)}
        size="small"
        status={status === 'cancelling' ? 'normal' : 'active'}
        className="task-run-placeholder__progress"
      />
      <div className="task-run-placeholder__logs" ref={logTailRef}>
        {tail.length > 0 ? (
          tail.map((line, index) => (
            <div key={`${logs.length - tail.length + index}-${line}`} className="task-run-placeholder__log-line">
              {line}
            </div>
          ))
        ) : (
          <div className="task-run-placeholder__log-line task-run-placeholder__log-line--muted">
            等待命令输出…
          </div>
        )}
      </div>
    </div>
  );
}
