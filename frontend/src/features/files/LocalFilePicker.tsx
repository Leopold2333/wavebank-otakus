import { useCallback, useEffect, useState } from 'react';
import {
  App,
  Button,
  Empty,
  Input,
  Modal,
  Space,
  Table,
  Typography,
  type TableColumnsType,
} from 'antd';
import { ArrowUpOutlined, FileOutlined, FolderOutlined } from '@ant-design/icons';
import {
  browseLocalFiles,
  type BrowseEntry,
  type BrowseResult,
} from '../../api/client';

interface LocalFilePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string, size?: number) => void;
}

function formatSize(size: number | null) {
  if (size === null) {
    return '-';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const COLUMNS: TableColumnsType<BrowseEntry> = [
  {
    title: '名称',
    dataIndex: 'name',
    render: (name: string, record) => (
      <Space>
        {record.type === 'dir' ? (
          <FolderOutlined style={{ color: '#faad14' }} />
        ) : (
          <FileOutlined style={{ color: '#1677ff' }} />
        )}
        <Typography.Text>{name}</Typography.Text>
      </Space>
    ),
  },
  {
    title: '路径',
    dataIndex: 'path',
    ellipsis: true,
  },
  {
    title: '大小',
    dataIndex: 'size',
    width: 110,
    render: formatSize,
  },
  {
    title: '修改时间',
    dataIndex: 'modified',
    width: 170,
    render: (value: number) => new Date(value).toLocaleString(),
  },
];

export function LocalFilePicker({ open, onClose, onSelect }: LocalFilePickerProps) {
  const { message } = App.useApp();
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadPath = useCallback(
    async (path?: string) => {
      setLoading(true);
      try {
        const result: BrowseResult = await browseLocalFiles(path);
        setCurrentPath(result.path);
        setParentPath(result.parent);
        setEntries(result.entries);
        setSelectedPath(result.is_file ? result.path : null);
      } catch (error) {
        message.error(error instanceof Error ? error.message : '读取目录失败');
      } finally {
        setLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    if (open) {
      void loadPath();
    }
  }, [open, loadPath]);

  const handleEntryClick = (entry: BrowseEntry) => {
    if (entry.type === 'dir') {
      void loadPath(entry.path);
      return;
    }
    setSelectedPath(entry.path);
  };

  return (
    <Modal
      title="选择本机文件"
      open={open}
      onCancel={onClose}
      width={720}
      okText="选择此文件"
      okButtonProps={{ disabled: !selectedPath }}
      onOk={() => {
        if (selectedPath) {
          const entry = entries.find((item) => item.path === selectedPath);
          onSelect(selectedPath, entry?.size ?? undefined);
        }
      }}
    >
      <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
        <Input
          value={currentPath}
          onChange={(event) => setCurrentPath(event.target.value)}
          onPressEnter={() => void loadPath(currentPath)}
          placeholder="输入本机目录或文件路径后回车"
        />
        <Button onClick={() => void loadPath(currentPath)}>跳转</Button>
        <Button
          icon={<ArrowUpOutlined />}
          disabled={!parentPath}
          onClick={() => void loadPath(parentPath ?? undefined)}
        >
          上级
        </Button>
      </Space.Compact>

      <Table<BrowseEntry>
        rowKey="path"
        size="small"
        loading={loading}
        dataSource={entries}
        pagination={false}
        scroll={{ y: 360 }}
        locale={{
          emptyText: loading ? (
            '加载中…'
          ) : (
            <Empty description="当前目录为空或不可读取" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ),
        }}
        onRow={(record) => ({
          onClick: () => handleEntryClick(record),
          style: {
            cursor: 'pointer',
            background: selectedPath === record.path ? '#e6f4ff' : undefined,
          },
        })}
        columns={COLUMNS}
      />
    </Modal>
  );
}
