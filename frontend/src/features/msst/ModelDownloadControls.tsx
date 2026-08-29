import { Button, Progress, Space, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import type { MsstDownloadState, MsstModelInfo } from '../../api/client';

export function ModelDownloadActions({
  model,
  download,
  onDownload,
  onCancel,
  buttonLabel = '下载模型',
}: {
  model: MsstModelInfo;
  download?: MsstDownloadState;
  onDownload: (model: MsstModelInfo) => void;
  onCancel: (model: MsstModelInfo) => void;
  buttonLabel?: string;
}) {
  const status = download?.status;
  const isDownloading = status === 'downloading';
  const isDownloaded = Boolean(model.downloaded || status === 'done');

  if (isDownloading) {
    return (
      <Space.Compact block>
        <Button disabled icon={<DownloadOutlined />}>
          下载中 {Math.round(download?.progress ?? 0)}%
        </Button>
        <Button danger onClick={() => onCancel(model)}>
          取消下载
        </Button>
      </Space.Compact>
    );
  }

  if (isDownloaded) {
    return null;
  }

  return (
    <Button icon={<DownloadOutlined />} onClick={() => onDownload(model)}>
      {buttonLabel}
    </Button>
  );
}

export function ModelDownloadProgress({
  download,
  className,
}: {
  download?: MsstDownloadState;
  className?: string;
}) {
  if (download?.status !== 'downloading') {
    return null;
  }
  const progress = Math.round(download.progress ?? 0);
  return (
    <div className={className}>
      <Progress
        percent={progress}
        size="small"
        format={() => `${progress}%`}
        style={{ maxWidth: '100%' }}
      />
      {download.stage ? (
        <Typography.Text type="secondary" className="msst-download-progress__stage">
          {download.stage}
        </Typography.Text>
      ) : null}
    </div>
  );
}
