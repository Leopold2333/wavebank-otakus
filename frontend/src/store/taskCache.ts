import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AudioTaskParams } from '../api/client';

export type TaskCacheStatus = 'newed' | 'reused';

/** 输出文件条目；多 stem 任务（人声分离）携带 stem 标签 */
export interface TaskOutputFile {
  path: string;
  ts?: number;
  stem?: string;
}

export interface TaskCacheEntry {
  taskId: string;
  taskType: string;
  inputFile: string;
  /** 参与 UUIDv5 计算的时间戳种子（毫秒） */
  timestamp: number;
  params: AudioTaskParams;
  status: TaskCacheStatus;
  outputFile: { path: string; ts: number } | null;
  /** 全部产物（人声分离为 vocals + instrumental）；单输出任务为空，回退 outputFile */
  outputFiles?: TaskOutputFile[] | null;
  /** 创建/最近使用时间（毫秒），用于决定当前输入文件的活跃绑定 */
  createdAt: number;
}

interface TaskCacheState {
  entries: Record<string, TaskCacheEntry>;
  upsertTask: (entry: TaskCacheEntry) => void;
  restoreTask: (
    taskId: string,
    data: Pick<
      TaskCacheEntry,
      'taskType' | 'inputFile' | 'timestamp' | 'params' | 'outputFile'
    > & { outputFiles?: TaskOutputFile[] | null },
  ) => void;
  updateParams: (taskId: string, params: AudioTaskParams) => void;
  updateOutput: (
    taskId: string,
    outputFile: { path: string; ts?: number } | null,
    outputFiles?: TaskOutputFile[] | null,
  ) => void;
  clearInput: (inputFile: string) => void;
  removeTask: (taskId: string) => void;
}

const MAX_ENTRIES = 30;

function withPrune(entries: Record<string, TaskCacheEntry>): Record<string, TaskCacheEntry> {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_ENTRIES) {
    return entries;
  }
  const stale = Object.values(entries)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, keys.length - MAX_ENTRIES);
  const next = { ...entries };
  for (const entry of stale) {
    delete next[entry.taskId];
  }
  return next;
}

export const useTaskCacheStore = create<TaskCacheState>()(
  persist(
    (set) => ({
      entries: {},
      upsertTask: (entry) =>
        set((state) => ({
          entries: withPrune({ ...state.entries, [entry.taskId]: entry }),
        })),
      restoreTask: (taskId, data) =>
        set((state) => {
          const prev = state.entries[taskId];
          const entry: TaskCacheEntry = prev
            ? { ...prev, ...data, status: 'reused', createdAt: Date.now() }
            : {
                taskId,
                ...data,
                status: 'reused',
                createdAt: Date.now(),
              };
          return { entries: withPrune({ ...state.entries, [taskId]: entry }) };
        }),
      updateParams: (taskId, params) =>
        set((state) => {
          const prev = state.entries[taskId];
          if (!prev) {
            return state;
          }
          return {
            entries: withPrune({
              ...state.entries,
              [taskId]: { ...prev, params },
            }),
          };
        }),
      updateOutput: (taskId, outputFile, outputFiles) =>
        set((state) => {
          const prev = state.entries[taskId];
          if (!prev) {
            return state;
          }
          return {
            entries: withPrune({
              ...state.entries,
              [taskId]: {
                ...prev,
                outputFile: outputFile
                  ? { path: outputFile.path, ts: outputFile.ts ?? Date.now() }
                  : null,
                outputFiles: outputFiles ?? null,
              },
            }),
          };
        }),
      clearInput: (inputFile) =>
        set((state) => {
          const entries = { ...state.entries };
          for (const [taskId, entry] of Object.entries(entries)) {
            if (entry.inputFile === inputFile) {
              delete entries[taskId];
            }
          }
          return { entries };
        }),
      removeTask: (taskId) =>
        set((state) => {
          const entries = { ...state.entries };
          delete entries[taskId];
          return { entries };
        }),
    }),
    {
      name: 'wavebank:task-cache',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function selectEntry(
  state: TaskCacheState,
  taskId: string | null | undefined,
): TaskCacheEntry | undefined {
  return taskId ? state.entries[taskId] : undefined;
}

export function selectLatestByInput(
  state: TaskCacheState,
  inputFile?: string,
): TaskCacheEntry | undefined {
  if (!inputFile) {
    return undefined;
  }
  return Object.values(state.entries)
    .filter((entry) => entry.inputFile === inputFile)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

export function selectLatestOutputByInput(
  state: TaskCacheState,
  inputFile?: string,
): TaskCacheEntry['outputFile'] {
  if (!inputFile) {
    return null;
  }
  return (
    Object.values(state.entries)
      .filter((entry) => entry.inputFile === inputFile && entry.outputFile)
      .sort((a, b) => b.createdAt - a.createdAt)[0]?.outputFile ?? null
  );
}

/** 最近一次产出文件的缓存条目（稳定引用），供组件派生单/多输出列表 */
export function selectLatestOutputEntryByInput(
  state: TaskCacheState,
  inputFile?: string,
): TaskCacheEntry | undefined {
  if (!inputFile) {
    return undefined;
  }
  return Object.values(state.entries)
    .filter((entry) => entry.inputFile === inputFile && entry.outputFile)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

/** 从缓存条目派生输出列表：多 stem 任务返回全部产物，否则回退主输出 */
export function entryOutputFiles(entry: TaskCacheEntry | undefined): TaskOutputFile[] {
  if (!entry) {
    return [];
  }
  if (entry.outputFiles && entry.outputFiles.length > 0) {
    return entry.outputFiles;
  }
  return entry.outputFile ? [entry.outputFile] : [];
}
