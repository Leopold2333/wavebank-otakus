import { Suspense, useState } from 'react';
import { Typography } from 'antd';
import { FileDoneOutlined } from '@ant-design/icons';
import { getFileContentUrl } from '../../api/client';
import { LocalFilePicker } from '../files/LocalFilePickerLazy';
import { useFileAttachments } from '../files/FileAttachmentsContext';
import { useTaskCacheStore } from '../../store/taskCache';
import { pathBasename } from '../../utils/format';
import { PanelHeader } from '../layout/PanelHeader';
import { AudioFilePreview } from './AudioFilePreview';
import { StyledMediaPlayer } from './StyledMediaPlayer';

type MediaKind = 'none' | 'audio' | 'video';

export function AudioFilePanel({
  onMediaKindChange,
  outputFile,
}: {
  onMediaKindChange: (kind: MediaKind) => void;
  outputFile?: { path: string; ts?: number } | null;
}) {
  const { attachments, setLocalPaths } = useFileAttachments();
  const clearTaskInput = useTaskCacheStore((state) => state.clearInput);
  const [pickerOpen, setPickerOpen] = useState(false);
  const path = attachments[0]?.path;

  return (
    <section
      className={`audio-file-panel${outputFile ? ' audio-file-panel--has-output' : ''}`}
    >
      <AudioFilePreview
        path={path}
        onPickFile={() => setPickerOpen(true)}
        onMediaKindChange={onMediaKindChange}
      />
      {outputFile ? (
        <div className="audio-output-preview">
          <div className="audio-output-preview__header">
            <PanelHeader icon={<FileDoneOutlined />}>输出文件</PanelHeader>
            <Typography.Text ellipsis className="audio-output-preview__name">
              {pathBasename(outputFile.path)}
            </Typography.Text>
          </div>
          <StyledMediaPlayer
            key={outputFile.path}
            src={`${getFileContentUrl(outputFile.path)}${outputFile.ts ? `&t=${outputFile.ts}` : ''}`}
            kind="audio"
            variant="output"
          />
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
