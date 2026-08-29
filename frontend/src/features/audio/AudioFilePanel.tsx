import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Select, Spin, Tag, Typography } from 'antd';
import { FileDoneOutlined } from '@ant-design/icons';
import { getFileContentUrl } from '../../api/client';
import { LocalFilePicker } from '../files/LocalFilePickerLazy';
import { useFileAttachments } from '../files/FileAttachmentsContext';
import { useTaskCacheStore, type TaskOutputFile } from '../../store/taskCache';
import { useTaskSnapshotMap } from '../tasks/useTaskSnapshotMap';
import { isVideoPath, pathBasename } from '../../utils/format';
import { PanelHeader } from '../layout/PanelHeader';
import { AudioFilePreview } from './AudioFilePreview';
import { StyledMediaPlayer } from './StyledMediaPlayer';
import { TaskRunPlaceholder, type TaskRunSnapshot } from './TaskRunPlaceholder';

const STEM_META: Record<string, { label: string; color: string }> = {
  vocals: { label: '人声', color: 'green' },
  instrumental: { label: '伴奏', color: 'blue' },
  bass: { label: '贝斯', color: 'purple' },
  drums: { label: '鼓', color: 'volcano' },
  guitar: { label: '吉他', color: 'orange' },
  piano: { label: '钢琴', color: 'gold' },
  other: { label: '其他', color: 'default' },
};

function stemMeta(stem?: string) {
  return STEM_META[stem ?? ''] ?? null;
}

/** 输出文件标签的最大总长度；超出时只截断前缀，后缀必须完整呈现 */
const MAX_OUTPUT_LABEL_LENGTH = 24;

/** 输出文件标签：优先保留 vocal / instrumental 这类关键后缀，按“前缀...后缀”展示 */
function formatOutputLabel(
  item: TaskOutputFile,
  maxLength = MAX_OUTPUT_LABEL_LENGTH,
): string {
  const name = pathBasename(item.path);
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const stem = item.stem?.trim();
  let suffix = '';
  let prefix = base;

  if (stem) {
    suffix = stem;
    prefix = base.endsWith(`_${stem}`)
      ? base.slice(0, -stem.length - 1)
      : base;
  } else {
    const match = base.match(/^(.*?)[-_]([^-.]+)$/);
    if (match && match[2].length <= 20) {
      suffix = match[2];
      prefix = match[1];
    }
  }

  const separator = prefix.match(/[-_.]$/)?.[0] ?? '_';
  prefix = prefix.replace(/[-_.]+$/, '').trim();
  const full = prefix ? `${prefix}${separator}${suffix}` : base;
  if (full.length <= maxLength) {
    return full;
  }
  // 后缀必须完整；若后缀本身已经接近上限，则退回完整文件名
  if (suffix.length >= maxLength - 3) {
    return base;
  }
  const prefixLimit = maxLength - 3 - suffix.length;
  return `${prefix.slice(0, Math.max(1, prefixLimit))}...${suffix}`;
}

export function AudioFilePanel({
  outputs,
  activeTaskId,
}: {
  /** 任务产物列表；人声分离按模型输出一条或多条音轨，其余为单输出 */
  outputs?: TaskOutputFile[] | null;
  /** 运行中的任务 ID：存在且未完成时在输出区渲染进度占位框 */
  activeTaskId?: string | null;
}) {
  const { attachments, setLocalPaths } = useFileAttachments();
  // 仅存在运行中任务时才订阅 SSE 快照通道
  const { tasks: taskSnapshots } = useTaskSnapshotMap(Boolean(activeTaskId));
  const runningTask = useMemo<TaskRunSnapshot | null>(() => {
    if (!activeTaskId) {
      return null;
    }
    const task = taskSnapshots[activeTaskId];
    if (!task) {
      // SSE 首帧未到：按排队中渲染，避免闪烁
      return { status: 'pending', progress: 0, logs: [] };
    }
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return null;
    }
    return task;
  }, [activeTaskId, taskSnapshots]);
  const clearTaskInput = useTaskCacheStore((state) => state.clearInput);
  const path = attachments[0]?.path;
  const isVideo = isVideoPath(path ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [outputVisible, setOutputVisible] = useState(false);
  const [outputItems, setOutputItems] = useState<TaskOutputFile[] | null>(null);
  const [selectedOutputIndex, setSelectedOutputIndex] = useState(0);
  const outputTimerRef = useRef<number | null>(null);
  const previousPathRef = useRef(path);
  const [previewSwitching, setPreviewSwitching] = useState(false);

  useLayoutEffect(() => {
    if (previousPathRef.current === path) {
      return;
    }
    previousPathRef.current = path;
    setPreviewSwitching(true);
    const timer = window.setTimeout(() => setPreviewSwitching(false), 160);
    return () => window.clearTimeout(timer);
  }, [path]);

  const previewLoading = previewSwitching || previousPathRef.current !== path;

  useEffect(() => {
    if (outputs && outputs.length > 0) {
      if (outputTimerRef.current) {
        window.clearTimeout(outputTimerRef.current);
        outputTimerRef.current = null;
      }
      setOutputItems(outputs);
      setSelectedOutputIndex(0);
      setOutputVisible(false);
      const frame = window.requestAnimationFrame(() => setOutputVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setOutputVisible(false);
    if (outputTimerRef.current) {
      window.clearTimeout(outputTimerRef.current);
    }
    outputTimerRef.current = window.setTimeout(() => {
      setOutputItems(null);
      outputTimerRef.current = null;
    }, 300);
    return () => {
      if (outputTimerRef.current) {
        window.clearTimeout(outputTimerRef.current);
        outputTimerRef.current = null;
      }
    };
  }, [outputs]);

  const hasOutputPanel = Boolean(outputItems && outputItems.length > 0);
  const hasRunningPlaceholder = Boolean(runningTask);
  const isMultiOutput = (outputItems?.length ?? 0) > 1;
  const selectedIndex = Math.min(
    selectedOutputIndex,
    Math.max(0, (outputItems?.length ?? 1) - 1),
  );
  const selectedOutput = outputItems?.[selectedIndex] ?? outputItems?.[0] ?? null;
  const selectedMeta = selectedOutput ? stemMeta(selectedOutput.stem) : null;

  return (
    <section
      className={`audio-file-panel${
        hasOutputPanel ? ' audio-file-panel--has-output' : ''
      }${hasRunningPlaceholder ? ' audio-file-panel--running' : ''}${
        isVideo ? ' audio-file-panel--video' : ''
      }`}
    >
      <Spin
        spinning={previewLoading}
        description="正在加载文件预览…"
        size="large"
        rootClassName="audio-file-panel__spin"
      >
        <AudioFilePreview
          path={path}
          onPickFile={() => setPickerOpen(true)}
        />
      </Spin>
      {runningTask ? (
        <div className="audio-output-preview audio-output-preview--visible audio-output-preview--running">
          <div className="audio-output-preview__content">
            <TaskRunPlaceholder task={runningTask} />
          </div>
        </div>
      ) : null}
      {hasOutputPanel && outputItems && !runningTask ? (
        <div
          className={`audio-output-preview${
            outputVisible ? ' audio-output-preview--visible' : ''
          }`}
          aria-hidden={!outputVisible}
        >
          <div className="audio-output-preview__content">
            <div className="audio-output-preview__header">
              <PanelHeader icon={<FileDoneOutlined />}>输出文件</PanelHeader>
              <div className="audio-output-preview__header-right">
                {selectedOutput ? (
                  <>
                    {selectedMeta ? (
                      <Tag
                        color={selectedMeta.color}
                        className="audio-output-preview__stem-tag"
                      >
                        {selectedMeta.label}
                      </Tag>
                    ) : null}
                    <Typography.Text
                      ellipsis
                      className="audio-output-preview__name"
                      title={pathBasename(selectedOutput.path)}
                    >
                      {pathBasename(selectedOutput.path)}
                    </Typography.Text>
                  </>
                ) : null}
                {isMultiOutput && outputItems ? (
                  <Select
                    size="small"
                    className="audio-output-preview__select"
                    value={selectedIndex}
                    onChange={(value) => setSelectedOutputIndex(Number(value))}
                  options={outputItems.map((item, index) => ({
                    value: index,
                    label: item.stem?.trim() || formatOutputLabel(item),
                  }))}
                  />
                ) : null}
              </div>
            </div>
            {outputVisible ? (
              <div className="audio-output-preview__players">
                {selectedOutput ? (
                  <div
                    key={selectedOutput.path}
                    className="audio-output-preview__player"
                  >
                    <StyledMediaPlayer
                      key={selectedOutput.path}
                      src={`${getFileContentUrl(selectedOutput.path)}${
                        selectedOutput.ts ? `&t=${selectedOutput.ts}` : ''
                      }`}
                      kind="audio"
                      variant="output"
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="audio-output-preview__player-placeholder" />
            )}
          </div>
        </div>
      ) : null}
      {attachments.length > 1 ? (
        <Typography.Text type="warning" className="audio-file-panel__notice">
          当前仅处理第一个文件，其余附件不会参与任务。
        </Typography.Text>
      ) : null}
      <Suspense fallback={null}>
        <LocalFilePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(selectedPath, size) => {
            const previousPath = attachments[0]?.path;
            if (previousPath && previousPath !== selectedPath) {
              clearTaskInput(previousPath);
            }
            // 手动选择文件视为“为全新任务做准备”：清掉该路径的历史绑定，
            // 避免刷新后选择同名文件又恢复旧任务的输出与 UUID。
            clearTaskInput(selectedPath);
            setLocalPaths([
              {
                name: pathBasename(selectedPath),
                path: selectedPath,
                size,
                source: 'manual',
              },
            ]);
            setPickerOpen(false);
          }}
        />
      </Suspense>
    </section>
  );
}
