import { Button, Segmented, Space, Tag, Tooltip, Typography } from 'antd';
import {
  ReloadOutlined,
  SlidersOutlined,
} from '@ant-design/icons';
import { PanelHeader } from '../layout/PanelHeader';
import { useFileAttachments } from '../files/FileAttachmentsContext';
import {
  AUDIO_SUBTYPES,
  DEFAULT_AUDIO_SUBTYPE,
  type AudioSubtypeId,
} from './audioSubtypes';
import type { IntentId } from '../../types';
import { INTENT_DEFINITIONS, INTENT_MAP } from './intentRegistry';
import { IntentConfigPanel } from './IntentConfigPanel';
import { useTaskCacheStore } from '../../store/taskCache';

interface ParamWindowProps {
  activeIntent: IntentId | null;
  activeSubtype: AudioSubtypeId | null;
  onSelectIntent: (intent: IntentId | null) => void;
  onSelectSubtype: (subtype: AudioSubtypeId) => void;
  onTaskCreated?: (taskId: string, mode: 'new' | 'rebuild') => void;
  taskPending?: boolean;
  taskPendingMode?: 'new' | 'rebuild' | null;
  restoreTask?: { taskId: string; token: number } | null;
}

export function ParamWindow({
  activeIntent,
  activeSubtype,
  onSelectIntent,
  onSelectSubtype,
  onTaskCreated,
  taskPending,
  taskPendingMode,
  restoreTask,
}: ParamWindowProps) {
  const { attachments, removeAttachment } = useFileAttachments();
  const clearTaskInput = useTaskCacheStore((state) => state.clearInput);
  const intent = activeIntent ? INTENT_MAP[activeIntent] : null;
  const effectiveSubtype = activeSubtype ?? DEFAULT_AUDIO_SUBTYPE;

  const handleReselectFile = () => {
    for (const attachment of attachments) {
      clearTaskInput(attachment.path);
      removeAttachment(attachment.id);
    }
  };

  return (
    <section className="param-window">
      <div className="param-window__header">
        <PanelHeader icon={<SlidersOutlined />}>人工参数窗</PanelHeader>
        <Space>
          {intent ? (
            <Button icon={<ReloadOutlined />} onClick={handleReselectFile}>
              重选文件
            </Button>
          ) : null}
        </Space>
      </div>

      <div className="param-window__content">
        {!intent ? (
          <div className="intent-grid">
            {INTENT_DEFINITIONS.map((definition) => (
              <button
                key={definition.id}
                type="button"
                className="intent-card"
                onClick={() => onSelectIntent(definition.id)}
              >
                <span className="intent-card__icon">{definition.icon}</span>
                <span className="intent-card__meta">
                  <strong>{definition.label}</strong>
                  <small>{definition.agent}</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="param-window__intent">
              <Space wrap>
                <Tag color="blue" icon={intent.icon}>
                  {intent.label}
                </Tag>
                <Typography.Text type="secondary">{intent.description}</Typography.Text>
              </Space>
            </div>
            {intent.id === 'audio' ? (
              <Segmented
                block
                className="audio-subtype-switch"
                value={effectiveSubtype}
                options={AUDIO_SUBTYPES.map((subtype) => ({
                  value: subtype.id,
                  label: (
                    <Tooltip title={subtype.description}>
                      <Space>
                        {subtype.icon}
                        {subtype.label}
                      </Space>
                    </Tooltip>
                  ),
                }))}
                onChange={(value) => onSelectSubtype(value as AudioSubtypeId)}
              />
            ) : null}
            <IntentConfigPanel
              intentId={intent.id}
              subtype={intent.id === 'audio' ? effectiveSubtype : undefined}
              onTaskCreated={onTaskCreated}
              taskPending={taskPending}
              taskPendingMode={taskPendingMode}
              restoreTask={restoreTask}
            />
          </>
        )}
      </div>
    </section>
  );
}
