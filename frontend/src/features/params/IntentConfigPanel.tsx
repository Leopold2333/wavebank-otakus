import {
  Alert,
  App,
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  Select,
  Slider,
  Switch,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAudioTask, type AudioTaskParams } from '../../api/client';
import { useFileAttachments } from '../files/FileAttachmentsContext';
import {
  selectEntry,
  selectLatestByInput,
  useTaskCacheStore,
} from '../../store/taskCache';
import type { IntentId } from '../../types';
import {
  AUDIO_SUBTYPES,
  COMMON_OUTPUT_FIELDS,
  LOSSLESS_OUTPUT_FORMATS,
  getAudioSubtype,
  type AudioSubtypeId,
} from './audioSubtypes';
import { INTENT_MAP, type IntentField } from './intentRegistry';
import { isVideoPath } from '../../utils/format';

const DEFAULT_AUDIO_SUBTYPE = AUDIO_SUBTYPES[0].id;

function FieldItem({
  field,
  fill,
  disabled,
}: {
  field: IntentField;
  fill?: boolean;
  disabled?: boolean;
}) {
  const common = {
    name: field.name,
    label: field.label,
    tooltip: field.tooltip,
  };
  const fillStyle = fill ? { width: '100%', maxWidth: 240 } : undefined;

  if (field.type === 'select') {
    return (
      <Form.Item {...common}>
        <Select
          disabled={disabled}
          options={field.options}
          placeholder={field.placeholder}
          style={fillStyle ?? { maxWidth: 360 }}
        />
      </Form.Item>
    );
  }

  if (field.type === 'number') {
    return (
      <Form.Item {...common}>
        <InputNumber
          min={field.min}
          max={field.max}
          step={field.step}
          placeholder={field.placeholder}
          onPressEnter={(event) => {
            event.preventDefault();
            event.currentTarget.blur();
          }}
          style={fillStyle ?? { maxWidth: 240 }}
        />
      </Form.Item>
    );
  }

  if (field.type === 'switch') {
    return (
      <Form.Item {...common} valuePropName="checked">
        <Switch />
      </Form.Item>
    );
  }

  if (field.type === 'slider') {
    return (
      <Form.Item {...common}>
        <Slider min={field.min} max={field.max} step={field.step} style={{ maxWidth: 360 }} />
      </Form.Item>
    );
  }

  return (
    <Form.Item {...common}>
      <Input
        placeholder={field.placeholder}
        onPressEnter={(event) => {
          event.preventDefault();
          event.currentTarget.blur();
        }}
        style={fillStyle ?? { maxWidth: 480 }}
      />
    </Form.Item>
  );
}

interface IntentConfigPanelProps {
  intentId: IntentId;
  subtype?: AudioSubtypeId;
  onTaskCreated?: (taskId: string, mode: 'new' | 'rebuild') => void;
  taskPending?: boolean;
  taskPendingMode?: 'new' | 'rebuild' | null;
  restoreTask?: { taskId: string; token: number } | null;
}

export function IntentConfigPanel({
  intentId,
  subtype,
  onTaskCreated,
  taskPending,
  taskPendingMode,
  restoreTask,
}: IntentConfigPanelProps) {
  const { message } = App.useApp();
  const { attachments } = useFileAttachments();
  const [form] = Form.useForm();
  const speedValue = Form.useWatch('speed', form);
  const pitchValue = Form.useWatch('pitchSemitones', form);
  const outputFormat = Form.useWatch('outputFormat', form);
  const pitchAutoRef = useRef(true);
  const applyingAutoPitchRef = useRef(false);
  const submitModeRef = useRef<'new' | 'rebuild'>('new');
  const [submittingMode, setSubmittingMode] = useState<'new' | 'rebuild' | null>(null);

  const intent = INTENT_MAP[intentId];
  const isAudio = intentId === 'audio';
  const audioSubtype = isAudio ? getAudioSubtype(subtype ?? DEFAULT_AUDIO_SUBTYPE) : null;
  const subtypeFields = audioSubtype?.fields ?? [];
  const nonAudioInputFields = isAudio
    ? []
    : intent.fields.filter((field) => field.name !== 'inputFile' && field.name !== 'outputFormat');
  const nonAudioOutputFields = isAudio
    ? []
    : intent.fields.filter((field) => field.name === 'outputFormat');
  const fields = useMemo(
    () =>
      isAudio
        ? [...subtypeFields, ...COMMON_OUTPUT_FIELDS]
        : [...nonAudioInputFields, ...nonAudioOutputFields],
    [isAudio, subtypeFields, intent.fields],
  );

  const inputPath = attachments[0]?.path;
  const isLossless =
    outputFormat != null &&
    (LOSSLESS_OUTPUT_FORMATS as readonly string[]).includes(String(outputFormat));
  const cacheEntry = useTaskCacheStore((state) => selectLatestByInput(state, inputPath));
  const upsertTask = useTaskCacheStore((state) => state.upsertTask);
  const updateParams = useTaskCacheStore((state) => state.updateParams);

  const initialValues = useMemo(
    () =>
      Object.fromEntries(
        fields
          .filter((field) => field.defaultValue !== undefined)
          .map((field) => [field.name, field.defaultValue]),
      ),
    [fields],
  );

  const applyParamsToForm = useCallback(
    (params: AudioTaskParams, options?: { manualPitch?: boolean }) => {
      const patch: Record<string, unknown> = {};
      for (const field of fields) {
        const value = params[field.name as keyof AudioTaskParams];
        if (value !== undefined && value !== null && value !== '') {
          patch[field.name] = value;
        }
      }
      if (Object.keys(patch).length > 0) {
        applyingAutoPitchRef.current = true;
        form.setFieldsValue(patch);
        applyingAutoPitchRef.current = false;
      }
      if (options?.manualPitch && patch.pitchSemitones !== undefined) {
        pitchAutoRef.current = false;
      }
    },
    [fields, form],
  );

  useEffect(() => {
    if (!isAudio) {
      return;
    }
    for (const field of fields) {
      if (field.defaultValue === undefined) {
        continue;
      }
      const current = form.getFieldValue(field.name);
      if (current === undefined || current === null) {
        form.setFieldValue(field.name, field.defaultValue);
      }
    }
  }, [form, isAudio, fields]);

  useEffect(() => {
    if (!isAudio) {
      return;
    }
    if (attachments.length === 0) {
      form.setFieldValue('inputFile', undefined);
      return;
    }
    form.setFieldValue('inputFile', attachments[0].path);
  }, [form, attachments, isAudio]);

  // 同一输入文件已有缓存绑定：把该任务最后一次的参数恢复到表单。
  useEffect(() => {
    if (!isAudio || !inputPath) {
      return;
    }
    const entry = selectLatestByInput(useTaskCacheStore.getState(), inputPath);
    if (!entry) {
      return;
    }
    applyParamsToForm(entry.params, { manualPitch: true });
  }, [isAudio, inputPath, fields, applyParamsToForm]);

  // 从任务中心跳转回来：按指定任务恢复参数。
  useEffect(() => {
    if (!isAudio || !restoreTask) {
      return;
    }
    const entry = selectEntry(useTaskCacheStore.getState(), restoreTask.taskId);
    if (!entry) {
      return;
    }
    applyParamsToForm(entry.params, { manualPitch: true });
  }, [isAudio, restoreTask, applyParamsToForm]);

  useEffect(() => {
    if (!isAudio || audioSubtype?.id !== 'pitch') {
      return;
    }
    if (pitchValue == null || pitchValue === '') {
      pitchAutoRef.current = true;
    }
    if (!pitchAutoRef.current) {
      return;
    }
    const speed = Number(speedValue);
    if (!Number.isFinite(speed) || speed <= 0) {
      return;
    }
    const naturalSemitones = 12 * Math.log2(speed);
    const next = Math.round(naturalSemitones);
    if (naturalSemitones < -12 || naturalSemitones > 12) {
      if (pitchValue !== '' && pitchValue != null) {
        applyingAutoPitchRef.current = true;
        form.setFieldValue('pitchSemitones', undefined);
        applyingAutoPitchRef.current = false;
      }
      return;
    }
    if (pitchValue !== next) {
      applyingAutoPitchRef.current = true;
      form.setFieldValue('pitchSemitones', next);
      applyingAutoPitchRef.current = false;
    }
  }, [isAudio, audioSubtype?.id, speedValue, pitchValue, form]);

  const handleCreate = async (mode: 'new' | 'rebuild', values: Record<string, unknown>) => {
    const inputFileValue = values.inputFile || attachments[0]?.path;
    if (!inputFileValue) {
      message.warning('请先添加文件，或填写输入文件路径');
      return;
    }
    if (audioSubtype?.id === 'extract' && !isVideoPath(String(inputFileValue))) {
      message.error('不支持使用音频文件作为输入');
      return;
    }
    const currentEntry =
      mode === 'rebuild'
        ? selectLatestByInput(useTaskCacheStore.getState(), String(inputFileValue))
        : null;
    if (mode === 'rebuild' && !currentEntry) {
      message.warning('没有可重构的历史任务，请先新建任务');
      return;
    }
    const taskType = isAudio
      ? `audio.${audioSubtype?.id ?? DEFAULT_AUDIO_SUBTYPE}`
      : 'audio';
    const seedTimestamp =
      mode === 'rebuild' ? currentEntry!.timestamp : Date.now();
    const cleanValues = isLossless ? { ...values, bitrate: undefined } : values;
    const params = { ...cleanValues, inputFile: inputFileValue } as AudioTaskParams;

    setSubmittingMode(mode);
    try {
      const task = await createAudioTask(
        params,
        taskType,
        mode === 'rebuild'
          ? { mode, taskId: currentEntry!.taskId, timestamp: seedTimestamp }
          : { mode: 'new', timestamp: seedTimestamp },
      );
      upsertTask({
        taskId: task.id,
        taskType,
        inputFile: String(inputFileValue),
        timestamp: seedTimestamp,
        params,
        status: 'newed',
        outputFile: mode === 'rebuild' ? (currentEntry?.outputFile ?? null) : null,
        createdAt: Date.now(),
      });
      onTaskCreated?.(task.id, mode);
      message.success(`任务已创建：${task.id}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建任务失败');
    } finally {
      setSubmittingMode(null);
    }
  };

  return (
    <div className="intent-config-panel">
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onValuesChange={(changedValues) => {
          if ('pitchSemitones' in changedValues && !applyingAutoPitchRef.current) {
            const next = changedValues.pitchSemitones;
            pitchAutoRef.current = next == null || next === '';
          }
          if (cacheEntry && isAudio) {
            updateParams(cacheEntry.taskId, {
              ...cacheEntry.params,
              ...changedValues,
              inputFile: inputPath ?? cacheEntry.inputFile,
            });
          }
        }}
        style={{ marginTop: 16 }}
        onFinish={(values) => {
          const mode = submitModeRef.current;
          submitModeRef.current = 'new';
          void handleCreate(mode, values);
        }}
      >
        {isAudio ? (
          <>
            {subtypeFields.length > 0 ? (
              <div className="audio-param-fields">
                {subtypeFields.map((field) => (
                  <FieldItem key={field.name} field={field} fill />
                ))}
              </div>
            ) : null}
            {attachments.length > 1 ? (
              <Alert
                type="warning"
                showIcon
                title="当前仅支持单个文件"
                description="非批量处理功能严格只处理单个文件，将使用第一个已添加文件。"
                style={{ marginBottom: 12 }}
              />
            ) : null}
            <Divider plain>输出参数</Divider>
            <div className="audio-output-grid">
              {COMMON_OUTPUT_FIELDS.map((field) => (
                <FieldItem
                  key={field.name}
                  field={field}
                  fill
                  disabled={field.name === 'bitrate' && isLossless}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            {nonAudioInputFields.length > 0 ? (
              <div className="audio-param-fields">
                {nonAudioInputFields.map((field) => (
                  <FieldItem key={field.name} field={field} fill />
                ))}
              </div>
            ) : null}
            {nonAudioOutputFields.length > 0 ? (
              <>
                <Divider plain>输出参数</Divider>
                <div className="audio-output-grid">
                  {nonAudioOutputFields.map((field) => (
                    <FieldItem key={field.name} field={field} fill />
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
        <Form.Item>
          <div className="intent-config-panel__actions">
            <Button disabled>保存为预设（待接入）</Button>
            {isAudio ? (
              <Button
                color="green"
                variant="solid"
                icon={<ReloadOutlined />}
                htmlType="submit"
                loading={
                  submittingMode === 'rebuild' || (taskPending && taskPendingMode === 'rebuild')
                }
                disabled={taskPending || !cacheEntry}
                onClick={() => {
                  submitModeRef.current = 'rebuild';
                }}
              >
                重构输出
              </Button>
            ) : null}
            <Button
              type="primary"
              icon={<PlusOutlined />}
              htmlType="submit"
              loading={submittingMode === 'new' || (taskPending && taskPendingMode === 'new')}
              disabled={taskPending || !isAudio}
              onClick={() => {
                submitModeRef.current = 'new';
              }}
            >
              {isAudio ? '新建任务' : '待接入'}
            </Button>
          </div>
        </Form.Item>
      </Form>
    </div>
  );
}
