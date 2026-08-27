import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Spin, Tag, Typography } from 'antd';
import { FileDoneOutlined } from '@ant-design/icons';
import { getFileContentUrl } from '../../api/client';
import { LocalFilePicker } from '../files/LocalFilePickerLazy';
import { useFileAttachments } from '../files/FileAttachmentsContext';
import { useTaskCacheStore, type TaskOutputFile } from '../../store/taskCache';
import { isVideoPath, pathBasename } from '../../utils/format';
import { PanelHeader } from '../layout/PanelHeader';
import { AudioFilePreview } from './AudioFilePreview';
import { StyledMediaPlayer } from './StyledMediaPlayer';

const STEM_META: Record<string, { label: string; color: string }> = {
  vocals: { label: '人声', color: 'green' },
  instrumental: { label: '伴奏', color: 'blue' },
};

function stemMeta(stem?: string) {
  return STEM_META[stem ?? ''] ?? null;
}

export function AudioFilePanel({
  outputs,
}: {
  /** 任务产物列表；人声分离携带 vocals/instrumental 双输出，其余为单输出 */
  outputs?: TaskOutputFile[] | null;
}) {
  const { attachments, setLocalPaths } = useFileAttachments();
  const clearTaskInput = useTaskCacheStore((state) => state.clearInput);
  const path = attachments[0]?.path;
  const isVideo = isVideoPath(path ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [outputVisible, setOutputVisible] = useState(false);
  const [outputItems, setOutputItems] = useState<TaskOutputFile[] | null>(null);
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
  const isMultiOutput = (outputItems?.length ?? 0) > 1;
  const primaryOutput = outputItems?.[0] ?? null;

  return (
    <section
      className={`audio-file-panel${
        hasOutputPanel ? ' audio-file-panel--has-output' : ''
      }${isVideo ? ' audio-file-panel--video' : ''}`}
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
      {hasOutputPanel && outputItems ? (
        <div
          className={`audio-output-preview${
            outputVisible ? ' audio-output-preview--visible' : ''
          }`}
          aria-hidden={!outputVisible}
        >
          <div className="audio-output-preview__content">
            <div className="audio-output-preview__header">
              <PanelHeader icon={<FileDoneOutlined />}>输出文件</PanelHeader>
              <Typography.Text ellipsis className="audio-output-preview__name">
                {isMultiOutput
                  ? `${outputItems.length} 个产物`
                  : pathBasename(primaryOutput?.path ?? '')}
              </Typography.Text>
            </div>
            {outputVisible ? (
              <div
                className={`audio-output-preview__players${
                  isMultiOutput ? ' audio-output-preview__players--grid' : ''
                }`}
              >
                {outputItems.map((item) => {
                  const meta = stemMeta(item.stem);
                  return (
                    <div
                      key={item.path}
                      className="audio-output-preview__player"
                    >
                      {meta ? (
                        <div className="audio-output-preview__stem">
                          <Tag color={meta.color} className="audio-output-preview__stem-tag">
                            {meta.label}
                          </Tag>
                          <Typography.Text
                            ellipsis
                            className="audio-output-preview__stem-name"
                            title={pathBasename(item.path)}
                          >
                            {pathBasename(item.path)}
                          </Typography.Text>
                        </div>
                      ) : null}
                      <StyledMediaPlayer
                        key={item.path}
                        src={`${getFileContentUrl(item.path)}${item.ts ? `&t=${item.ts}` : ''}`}
                        kind="audio"
                        variant="output"
                      />
                    </div>
                  );
                })}
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
