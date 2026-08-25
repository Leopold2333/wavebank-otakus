import { Button, Tooltip, Typography } from 'antd';
import { CloseOutlined, FileOutlined } from '@ant-design/icons';
import type { FileAttachment } from './FileAttachmentsContext';
import { formatFileSize } from '../../utils/format';

interface AttachmentListProps {
  attachments: FileAttachment[];
  onRemove: (id: string) => void;
}

export function AttachmentList({ attachments, onRemove }: AttachmentListProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="attachment-list">
      {attachments.map((file) => (
        <div key={file.id} className="attachment-chip">
          <FileOutlined className="attachment-chip__icon" />
          <Tooltip title={file.path}>
            <Typography.Text className="attachment-chip__name" ellipsis>
              {file.name}
            </Typography.Text>
          </Tooltip>
          <span className="attachment-chip__meta">{formatFileSize(file.size)}</span>
          <Button
            type="text"
            size="small"
            className="attachment-chip__remove"
            icon={<CloseOutlined />}
            aria-label={`移除 ${file.name}`}
            onClick={() => onRemove(file.id)}
          />
        </div>
      ))}
    </div>
  );
}
