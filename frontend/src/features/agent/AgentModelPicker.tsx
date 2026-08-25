import { Button, Divider, Popover } from 'antd';
import {
  CheckOutlined,
  RightOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { useState } from 'react';
import type { AgentModelInfo } from '../../api/client';
import type { AgentReasoningLevel } from '../../store/agentConversation';

const REASONING_OPTIONS: Array<{
  value: AgentReasoningLevel;
  label: string;
}> = [
  { value: 'off', label: '无' },
  { value: 'low', label: '轻度' },
  { value: 'medium', label: '中等' },
  { value: 'high', label: '高' },
  { value: 'max', label: '超高' },
];

interface AgentModelPickerProps {
  model: string;
  defaultModel: string;
  reasoning: AgentReasoningLevel;
  models: AgentModelInfo[];
  onModelChange: (model: string) => void;
  onReasoningChange: (reasoning: AgentReasoningLevel) => void;
}

export function AgentModelPicker({
  model,
  defaultModel,
  reasoning,
  models,
  onModelChange,
  onReasoningChange,
}: AgentModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const effectiveModel = model || defaultModel || '未选择模型';
  const reasoningLabel =
    REASONING_OPTIONS.find((option) => option.value === reasoning)?.label ?? '高';

  const selectReasoning = (value: AgentReasoningLevel) => {
    onReasoningChange(value);
    setModelOpen(false);
    setOpen(false);
  };

  const selectModel = (value: string) => {
    onModelChange(value);
    setModelOpen(false);
    setOpen(false);
  };

  const content = (
    <div className="agent-picker">
      <div className="agent-picker__section">
        {REASONING_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`agent-picker__item${
              reasoning === option.value ? ' agent-picker__item--active' : ''
            }`}
            onClick={() => selectReasoning(option.value)}
          >
            <span>{option.label}</span>
            {reasoning === option.value ? <CheckOutlined /> : null}
          </button>
        ))}
      </div>
      <Divider style={{ margin: '6px 0' }} />
      <div
        className="agent-picker__model"
      >
        <div
          className="agent-picker__model-row"
          onClick={() => setModelOpen((value) => !value)}
        >
          <span>模型名称</span>
          {modelOpen ? null : <RightOutlined />}
        </div>
        {modelOpen ? (
          <div className="agent-picker__model-list">
            {models.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`agent-picker__item${
                  effectiveModel === item.id ? ' agent-picker__item--active' : ''
                }`}
                onClick={() => selectModel(item.id)}
              >
                <span className="agent-picker__model-name" title={item.id}>
                  {item.id}
                </span>
                {effectiveModel === item.id ? <CheckOutlined /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="topRight"
      arrow={false}
      open={open}
      onOpenChange={setOpen}
    >
      <Button size="small" type="text" icon={<UpOutlined />} iconPlacement="end">
        {effectiveModel} · {reasoningLabel}
      </Button>
    </Popover>
  );
}
