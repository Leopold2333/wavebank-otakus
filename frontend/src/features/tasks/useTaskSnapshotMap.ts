import { useEffect, useRef, useState } from 'react';
import { getTasks, type TaskRecord } from '../../api/client';

export interface TaskSnapshotState {
  /** taskId -> 最新任务快照 */
  tasks: Record<string, TaskRecord>;
  /** SSE 通道当前是否连通（false = 断线降级轮询模式） */
  live: boolean;
  /** 是否已收到任意一帧数据（REST 兜底或 SSE 快照） */
  ready: boolean;
}

/**
 * 订阅任务中心相同的 SSE 快照通道（`/api/tasks/events`，0.5s 全量快照）。
 *
 * 连接策略与任务中心一致：SSE 推送为准；断线指数退避重连（1s→30s），
 * 断线期间 5s 轮询兜底；首帧前先做一次 REST 拉取避免空白。
 * `enabled=false` 时不建立任何连接（按需订阅，空闲零开销）。
 */
export function useTaskSnapshotMap(enabled: boolean = true): TaskSnapshotState {
  const [tasks, setTasks] = useState<Record<string, TaskRecord>>({});
  const [live, setLive] = useState(false);
  const [ready, setReady] = useState(false);
  const liveRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let retryDelay = 1000;
    let disposed = false;

    const ingest = (list: TaskRecord[]) => {
      const next: Record<string, TaskRecord> = {};
      for (const task of list) {
        next[task.id] = task;
      }
      setTasks(next);
      setReady(true);
    };

    const connect = () => {
      if (disposed || typeof EventSource === 'undefined') {
        return;
      }
      source = new EventSource('/api/tasks/events');
      source.addEventListener('tasks.snapshot', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as {
            tasks: TaskRecord[];
          };
          liveRef.current = true;
          setLive(true);
          retryDelay = 1000;
          ingest(data.tasks);
        } catch {
          // 忽略无法解析的快照，等待下一帧
        }
      });
      source.onerror = () => {
        liveRef.current = false;
        setLive(false);
        source?.close();
        source = null;
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
      };
    };

    // SSE 未就绪期间先拉一次，避免占位组件空白
    getTasks()
      .then((response) => {
        if (!disposed && !liveRef.current) {
          ingest(response.tasks);
        }
      })
      .catch(() => {
        // 静默：SSE 连上后会覆盖
      });

    connect();

    // 断线 fallback 轮询（仅 SSE 失效时）
    const timer = window.setInterval(() => {
      if (liveRef.current || disposed) {
        return;
      }
      getTasks()
        .then((response) => ingest(response.tasks))
        .catch(() => {
          // 等待下一轮
        });
    }, 5000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      source?.close();
    };
  }, [enabled]);

  return { tasks, live, ready };
}
