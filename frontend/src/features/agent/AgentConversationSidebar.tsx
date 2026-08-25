import { useEffect, useState } from 'react';
import { Button, Empty, Popconfirm, Tooltip, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  getAgentConversations,
  type AgentConversationSummary,
} from '../../api/client';

interface AgentConversationSidebarProps {
  activeConversationId: string | null;
  refreshKey: number;
  /** 流式输出期间禁用切换/删除会话 */
  disabled?: boolean;
  onSelect: (conversationId: string) => void;
  onNewConversation: () => void;
  onDelete: (conversationId: string) => void;
}

function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) {
    return '刚刚';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays} 天前`;
  }
  return date.toLocaleDateString('zh-CN');
}

export function AgentConversationSidebar({
  activeConversationId,
  refreshKey,
  disabled = false,
  onSelect,
  onNewConversation,
  onDelete,
}: AgentConversationSidebarProps) {
  const [conversations, setConversations] = useState<AgentConversationSummary[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    getAgentConversations()
      .then((response) => {
        if (!cancelled) {
          setConversations(response.conversations);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, reloadTick]);

  return (
    <aside className="agent-conversations">
      <div className="agent-conversations__header">
        <Typography.Text strong>会话</Typography.Text>
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          disabled={disabled}
          onClick={onNewConversation}
        >
          新建
        </Button>
      </div>
      <div className="agent-conversations__list">
        {loadError ? (
          <div className="agent-conversations__error">
            <Typography.Text type="secondary">
              会话列表加载失败，请确认后端已重启
            </Typography.Text>
            <Button size="small" onClick={() => setReloadTick((tick) => tick + 1)}>
              重试
            </Button>
          </div>
        ) : conversations.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={loading ? '加载中…' : '暂无会话，点击右下角开始新的对话'}
          />
        ) : (
          conversations.map((conversation) => {
            const active = conversation.id === activeConversationId;
            return (
              <div
                key={conversation.id}
                className={`agent-conversations__item${
                  active ? ' agent-conversations__item--active' : ''
                }`}
              >
                <Tooltip title={conversation.id} placement="right">
                  <button
                    type="button"
                    className="agent-conversations__item-main"
                    disabled={disabled}
                    onClick={() => onSelect(conversation.id)}
                  >
                    <span className="agent-conversations__item-id">
                      {conversation.id}
                    </span>
                    <span className="agent-conversations__item-time">
                      {formatConversationTime(conversation.updated_at)}
                    </span>
                  </button>
                </Tooltip>
                <Popconfirm
                  title="删除该会话？"
                  description="将删除会话消息记录，且无法恢复。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => onDelete(conversation.id)}
                >
                  <Button
                    type="text"
                    size="small"
                    className="agent-conversations__item-delete"
                    icon={<DeleteOutlined />}
                    aria-label="删除会话"
                    disabled={disabled}
                  />
                </Popconfirm>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
