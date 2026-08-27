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
import { useNavigate } from 'react-router-dom';
import {
  createAudioTask,
  getMsstModels,
  type AudioTaskParams,
  type MsstModelInfo,
} from '../../api/client';
import { useFileAttachments } from '../files/FileAttachmentsContext';
import {
  selectEntry,
  selectLatestByInput,
  useTaskCacheStore,
} from '../../store/taskCache';
import type { IntentId } from '../../types';
import {
  COMMON_OUTPUT_FIELDS,
  DEFAULT_AUDIO_SUBTYPE,
  LOSSLESS_OUTPUT_FORMATS,
  getAudioSubtype,
  taskTypeForIntent,
  type AudioSubtypeId,
} from './audioSubtypes';
import { INTENT_MAP, type IntentField } from './intentRegistry';
import { isVideoPath } from '../../utils/format';

/** 人声分离中支持展示“模型推荐值”的高级参数（数字输入型） */
const MSST_DEFAULT_VALUE_FIELDS = new Set(['batchSize', 'overlapSize', 'chunkSize']);

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
          disabled={disabled || field.disabled}
          options={field.options}
          placeholder={field.placeholder}
          showSearch
          filterOption={(input, option) => {
            const raw = option as unknown as Record<string, unknown>;
            const haystack = [raw?.searchText, raw?.label, raw?.value]
              .filter((part) => part != null)
              .map((part) => String(part).toLowerCase())
              .join(' ');
            return haystack.includes(input.trim().toLowerCase());
          }}
          style={fillStyle ?? { maxWidth: 360 }}
        />
      </Form.Item>
    );
  }

  if (field.type === 'number') {
    return (
      <Form.Item {...common}>
        <InputNumber
          disabled={disabled || field.disabled}
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
  const modelNameValue = Form.useWatch('modelName', form);
  const pitchAutoRef = useRef(true);
  const applyingAutoPitchRef = useRef(false);
  const submitModeRef = useRef<'new' | 'rebuild'>('new');
  const [submittingMode, setSubmittingMode] = useState<'new' | 'rebuild' | null>(null);

  const intent = INTENT_MAP[intentId];
  const isAudio = intentId === 'audio';
  const isSeparation = intentId === 'separation';
  const isTaskIntent = isAudio || isSeparation;
  const audioSubtype = isAudio ? getAudioSubtype(subtype ?? DEFAULT_AUDIO_SUBTYPE) : null;
  const activeTaskType = taskTypeForIntent(
    intentId,
    isAudio ? audioSubtype?.id : undefined,
  );
  const subtypeFields = useMemo(
    () => audioSubtype?.fields ?? [],
    [audioSubtype],
  );
  const nonAudioInputFields = useMemo(
    () =>
      isAudio
        ? []
        : intent.fields.filter(
            (field) =>
              field.name !== 'inputFile' &&
              field.name !== 'outputFormat' &&
              field.name !== 'outputFileName' &&
              !field.advanced,
          ),
    [isAudio, intent.fields],
  );
  const nonAudioAdvancedFields = useMemo(
    () =>
      isAudio
        ? []
        : intent.fields.filter(
            (field) =>
              field.advanced &&
              field.name !== 'inputFile' &&
              field.name !== 'outputFormat' &&
              field.name !== 'outputFileName',
          ),
    [isAudio, intent.fields],
  );
  const nonAudioOutputFields = useMemo(
    () =>
      isAudio
        ? []
        : intent.fields.filter(
            (field) =>
              field.name === 'outputFormat' || field.name === 'outputFileName',
          ),
    [isAudio, intent.fields],
  );
  const fields = useMemo(
    () =>
      isAudio
        ? [...subtypeFields, ...COMMON_OUTPUT_FIELDS]
        : [...nonAudioInputFields, ...nonAudioAdvancedFields, ...nonAudioOutputFields],
    [
      isAudio,
      subtypeFields,
      nonAudioInputFields,
      nonAudioAdvancedFields,
      nonAudioOutputFields,
    ],
  );

  const inputPath = attachments[0]?.path;
  const isLossless =
    outputFormat != null &&
    (LOSSLESS_OUTPUT_FORMATS as readonly string[]).includes(String(outputFormat));
  const cacheEntry = useTaskCacheStore((state) =>
    selectLatestByInput(state, inputPath, activeTaskType),
  );
  const upsertTask = useTaskCacheStore((state) => state.upsertTask);

  // 人声分离：从后端拉取 pymss 支持的模型清单填充下拉框
  const [msstModels, setMsstModels] = useState<MsstModelInfo[] | null>(null);
  const navigate = useNavigate();
  const availableMsstModels = useMemo(
    () => (msstModels ?? []).filter((model) => model.downloaded),
    [msstModels],
  );
  const hasAvailableMsstModels =
    msstModels !== null && availableMsstModels.length > 0;
  const msstModelOptions = useMemo(
    () =>
      availableMsstModels.map((model) => ({
        label: model.name.replace(/\.(ckpt|th|pt|yaml)$/i, ''),
        value: model.name,
        searchText: [
          model.name,
          ...(model.aliases ?? []),
          model.architecture,
          model.primaryCategoryCn,
          model.secondaryCategoryCn,
        ]
          .filter(Boolean)
          .join(' '),
      })),
    [availableMsstModels],
  );
  const msstModelTooltip = useMemo(() => {
    if (msstModels === null) {
      return '正在加载模型列表…';
    }
    const settingsLink = (
      <a
        href="/settings/msst"
        onClick={(event) => {
          event.preventDefault();
          navigate('/settings/msst');
        }}
      >
        设置页
      </a>
    );
    return hasAvailableMsstModels ? (
      <>不同的模型在处理复杂音频时差异较大，可前往{settingsLink}阅读模型能力简介。</>
    ) : (
      <>还没有可用模型捏，请前往{settingsLink}下载人声/伴奏双向分离类模型。</>
    );
  }, [msstModels, hasAvailableMsstModels, navigate]);
  useEffect(() => {
    if (!isSeparation) {
      return;
    }
    let cancelled = false;
    getMsstModels()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setMsstModels(response.models);
        const downloaded = response.models.filter((model) => model.downloaded);
        if (downloaded.length > 0) {
          const current = form.getFieldValue('modelName') as string | undefined;
          const known = new Set(downloaded.map((model) => model.name));
          if (!current || !known.has(current)) {
            form.setFieldValue(
              'modelName',
              known.has(response.defaultModel)
                ? response.defaultModel
                : downloaded[0].name,
            );
          }
        } else {
          form.setFieldValue('modelName', undefined);
        }
      })
      .catch(() => {
        // 拉取失败时保留注册表中的默认选项
      });
    return () => {
      cancelled = true;
    };
  }, [form, isSeparation]);

  const resolveField = useCallback(
    (field: IntentField): IntentField => {
      if (!isSeparation || field.name !== 'modelName') {
        return field;
      }
      if (msstModels === null) {
        return field;
      }
      if (!hasAvailableMsstModels) {
        return {
          ...field,
          options: [],
          placeholder: '暂无已下载模型，请前往设置页下载',
          disabled: true,
          tooltip: msstModelTooltip,
        };
      }
      return { ...field, options: msstModelOptions, tooltip: msstModelTooltip };
    },
    [
      isSeparation,
      msstModels,
      hasAvailableMsstModels,
      msstModelOptions,
      msstModelTooltip,
    ],
  );

  const currentMsstModel = useMemo(
    () => availableMsstModels.find((model) => model.name === modelNameValue) ?? null,
    [availableMsstModels, modelNameValue],
  );

  // 高级推理参数：在 tooltip 中展示当前模型 YAML 的推荐默认值
  const resolveAdvancedField = useCallback(
    (field: IntentField): IntentField => {
      if (
        !isSeparation ||
        !field.advanced ||
        !MSST_DEFAULT_VALUE_FIELDS.has(field.name)
      ) {
        return field;
      }
      const capability = currentMsstModel?.paramCapabilities?.[
        field.name as 'batchSize' | 'overlapSize' | 'chunkSize'
      ];
      if (capability === false) {
        return {
          ...field,
          disabled: true,
          tooltip: '该模型不使用此参数，将沿用模型配置',
        };
      }
      const defaults = currentMsstModel?.defaultInferenceParams;
      const defaultValue = defaults?.[
        field.name as 'batchSize' | 'overlapSize' | 'chunkSize'
      ];
      if (defaultValue != null) {
        return { ...field, tooltip: `留空使用模型推荐值: ${defaultValue.toLocaleString()}` };
      }
      if (currentMsstModel && currentMsstModel.downloaded === false) {
        return {
          ...field,
          tooltip: '留空使用模型推荐值: 待模型下载后显示',
        };
      }
      return field;
    },
    [isSeparation, currentMsstModel],
  );

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
    if (!isTaskIntent) {
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
  }, [form, isTaskIntent, fields]);

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
    if (!isTaskIntent || !inputPath) {
      return;
    }
    const entry = selectLatestByInput(useTaskCacheStore.getState(), inputPath, activeTaskType);
    if (!entry) {
      return;
    }
    applyParamsToForm(entry.params, { manualPitch: true });
  }, [isTaskIntent, inputPath, activeTaskType, fields, applyParamsToForm]);

  // 从任务中心跳转回来：按指定任务恢复参数。
  useEffect(() => {
    if (!isTaskIntent || !restoreTask) {
      return;
    }
    const entry = selectEntry(useTaskCacheStore.getState(), restoreTask.taskId);
    if (!entry) {
      return;
    }
    applyParamsToForm(entry.params, { manualPitch: true });
  }, [isTaskIntent, restoreTask, applyParamsToForm]);

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
        ? selectLatestByInput(
            useTaskCacheStore.getState(),
            String(inputFileValue),
            activeTaskType,
          )
        : null;
    if (mode === 'rebuild' && !currentEntry) {
      message.warning('没有可重构的历史任务，请先新建任务');
      return;
    }
    const taskType = isAudio
      ? `audio.${audioSubtype?.id ?? DEFAULT_AUDIO_SUBTYPE}`
      : isSeparation
        ? 'audio.vocal_separation'
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
            {isSeparation ? (
              <Alert
                type="info"
                showIcon
                title="输出固定为人声 + 伴奏两条音轨"
                description="产物文件名自动追加 _vocals / _instrumental 后缀；只有已下载的模型会出现在下方列表中。"
                style={{ marginBottom: 12 }}
              />
            ) : null}
            {isSeparation ? <Divider plain>模型选择</Divider> : null}
            {nonAudioInputFields.length > 0 ? (
              <div className="audio-param-fields">
                {nonAudioInputFields.map((field) => (
                  <FieldItem key={field.name} field={resolveField(field)} fill />
                ))}
              </div>
            ) : null}
            {isSeparation && msstModels !== null && !hasAvailableMsstModels ? (
              <Alert
                type="info"
                showIcon
                title="还没有可用模型"
                description={
                  <>
                    请前往{' '}
                    <a
                      href="/settings/msst"
                      onClick={(event) => {
                        event.preventDefault();
                        navigate('/settings/msst');
                      }}
                    >
                      设置页
                    </a>{' '}
                    下载人声/伴奏双向分离类模型后再回来。
                  </>
                }
                style={{ marginBottom: 12 }}
              />
            ) : null}
            {isSeparation &&
            currentMsstModel?.paramCapabilities?.chunkSize === false ? (
              <Alert
                type="info"
                showIcon
                title="当前模型为 Demucs 系普通模型"
                description="batchSize / overlapSize 仍可调整；chunkSize 不生效，将沿用模型配置。"
                style={{ marginBottom: 12 }}
              />
            ) : null}
            {nonAudioAdvancedFields.length > 0 ? (
              <>
                <Divider plain>高级推理参数（留空使用模型默认）</Divider>
                <div className="audio-param-fields">
                  {nonAudioAdvancedFields.map((field) => (
                    <FieldItem key={field.name} field={resolveAdvancedField(field)} fill />
                  ))}
                </div>
              </>
            ) : null}
            {attachments.length > 1 ? (
              <Alert
                type="warning"
                showIcon
                title="当前仅支持单个文件"
                description="人声分离严格只处理单个文件，将使用第一个已添加文件。"
                style={{ marginBottom: 12 }}
              />
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
              disabled={taskPending || !isTaskIntent}
              onClick={() => {
                submitModeRef.current = 'new';
              }}
            >
              {isTaskIntent ? '新建任务' : '待接入'}
            </Button>
          </div>
        </Form.Item>
      </Form>
    </div>
  );
}
