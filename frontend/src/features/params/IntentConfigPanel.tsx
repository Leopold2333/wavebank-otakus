import {
  Alert,
  App,
  Button,
  Checkbox,
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
import {
  createAudioTask,
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
import { INTENT_MAP, type IntentField, type IntentFieldOption } from './intentRegistry';
import { isVideoPath } from '../../utils/format';
import { ModelDownloadProgress } from '../msst/ModelDownloadControls';
import { useMsstModelLibrary } from '../msst/useMsstModelLibrary';
import { SeparationModelPicker } from './SeparationModelPicker';

/** 人声分离中会被模型 YAML 推荐值填充的高级参数（数字输入型） */
const MSST_DEFAULT_VALUE_FIELDS = new Set(['batchSize', 'overlapSize', 'chunkSize']);

function stemOptionsFromModel(model: MsstModelInfo | null): IntentFieldOption[] {
  const instruments = model?.config?.instruments;
  const rawStems =
    instruments && instruments.length > 0
      ? instruments
      : String(model?.targetStem ?? '')
          .split(/[/,]/)
          .map((item) => item.trim())
          .filter(Boolean);
  const seen = new Set<string>();
  const options: IntentFieldOption[] = [];
  for (const stem of rawStems) {
    const value = String(stem).trim().toLowerCase();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    options.push({
      label: value,
      value,
      searchText: String(stem).trim(),
    });
  }
  return options;
}

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
  const fillStyle = fill
    ? { width: '100%', maxWidth: field.multiple ? 360 : 240 }
    : undefined;

  if (field.type === 'select') {
    return (
      <Form.Item {...common}>
        <Select
          disabled={disabled || field.disabled}
          options={field.options}
          placeholder={field.placeholder}
          mode={field.multiple ? 'multiple' : undefined}
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
  const modelNameValue = Form.useWatch('modelName', { form, preserve: true });
  const pitchAutoRef = useRef(true);
  const previousStemModelRef = useRef<string | null>(null);
  const skipStemModelRef = useRef<string | null>(null);
  const previousDefaultsModelRef = useRef<string | null>(null);
  const skipDefaultsModelRef = useRef<string | null>(null);
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

  // 人声分离：全量 pymss catalog + 下载状态（与设置页共用同一套下载管理）
  const {
    catalog: msstCatalog,
    catalogError: msstCatalogError,
    downloads: msstDownloads,
    startDownload: startMsstDownloadAction,
    cancelDownload: cancelMsstDownloadAction,
  } = useMsstModelLibrary(isSeparation);
  const msstDeviceOptions = useMemo(
    () =>
      (msstCatalog?.devices ?? []).map((device) => ({
        ...device,
        disabled: device.available === false,
      })),
    [msstCatalog],
  );
  const allMsstModels = useMemo(() => msstCatalog?.models ?? [], [msstCatalog]);
  const currentMsstModel = useMemo(
    () => allMsstModels.find((model) => model.name === modelNameValue) ?? null,
    [allMsstModels, modelNameValue],
  );
  const currentMsstDownload = currentMsstModel
    ? msstDownloads[currentMsstModel.name]
    : undefined;
  const isMsstModelDownloaded = Boolean(
    currentMsstModel?.downloaded || currentMsstDownload?.status === 'done',
  );
  const isSeparationModelReady = Boolean(
    currentMsstModel && isMsstModelDownloaded,
  );
  const selectedStemOptions = useMemo(
    () => stemOptionsFromModel(currentMsstModel),
    [currentMsstModel],
  );
  const handleStartMsstDownload = async (model: MsstModelInfo) => {
    try {
      await startMsstDownloadAction(model);
      message.success(`已开始下载 ${model.name}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '开始下载失败');
    }
  };
  const handleCancelMsstDownload = async (model: MsstModelInfo) => {
    try {
      const result = await cancelMsstDownloadAction(model);
      message.info(
        `已取消下载 ${model.name}${
          result.cleaned?.length
            ? `，并清理 ${result.cleaned.length} 个残留文件`
            : '，并清理残留缓存'
        }`,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : '取消失败');
    }
  };
  const handleSeparationModelChange = useCallback(
    (name?: string) => {
      form.setFieldValue('modelName', name ?? undefined);
    },
    [form],
  );
  useEffect(() => {
    if (!isSeparation || selectedStemOptions.length === 0) {
      return;
    }
    const current = form.getFieldValue('selectedStems');
    const valid = new Set(selectedStemOptions.map((option) => String(option.value)));
    const existing = Array.isArray(current)
      ? current.filter((value) => valid.has(String(value)))
      : [];
    const modelChanged = previousStemModelRef.current !== modelNameValue;
    if (modelChanged) {
      previousStemModelRef.current = modelNameValue;
      const restoreStems = skipStemModelRef.current === modelNameValue;
      skipStemModelRef.current = null;
      const next =
        restoreStems && existing.length > 0
          ? existing
          : selectedStemOptions.map((option) => option.value);
      if (next.length !== (Array.isArray(current) ? current.length : -1)) {
        form.setFieldValue('selectedStems', next);
      }
      return;
    }
    if (!Array.isArray(current) || current.length === 0) {
      form.setFieldValue(
        'selectedStems',
        selectedStemOptions.map((option) => option.value),
      );
    }
  }, [isSeparation, modelNameValue, selectedStemOptions, form]);

  const resolveField = useCallback(
    (field: IntentField): IntentField => {
      if (!isSeparation) {
        return field;
      }
      if (field.name === 'device' && msstCatalog?.devices) {
        return { ...field, options: msstDeviceOptions };
      }
      return field;
    },
    [
      isSeparation,
      msstDeviceOptions,
      msstCatalog,
    ],
  );

  // 高级推理参数：只处理架构不支持时的禁用；tooltip 始终展示字段描述
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
        return { ...field, disabled: true };
      }
      return field;
    },
    [isSeparation, currentMsstModel],
  );

  // 选择模型后把模型 YAML 的推荐推理参数直接写进输入框
  useEffect(() => {
    if (!isSeparation || !currentMsstModel || !modelNameValue) {
      return;
    }
    const pendingSkipModel = skipDefaultsModelRef.current;
    skipDefaultsModelRef.current = null;
    if (pendingSkipModel === modelNameValue) {
      previousDefaultsModelRef.current = modelNameValue;
      return;
    }
    if (previousDefaultsModelRef.current === modelNameValue) {
      return;
    }
    previousDefaultsModelRef.current = modelNameValue;
    const defaults: Partial<
      Record<'batchSize' | 'overlapSize' | 'chunkSize', number>
    > = currentMsstModel.defaultInferenceParams ?? {};
    for (const key of ['batchSize', 'overlapSize', 'chunkSize'] as const) {
      if (currentMsstModel.paramCapabilities?.[key] === false) {
        form.setFieldValue(key, undefined);
        continue;
      }
      const value = defaults[key];
      form.setFieldValue(key, value != null && value > 0 ? value : undefined);
    }
  }, [isSeparation, currentMsstModel, modelNameValue, form]);

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
        let hasAdvancedDefaults = false;
        for (const key of MSST_DEFAULT_VALUE_FIELDS) {
          if (key in patch) {
            hasAdvancedDefaults = true;
            break;
          }
        }
        if (hasAdvancedDefaults) {
          skipDefaultsModelRef.current =
            (form.getFieldValue('modelName') as string | undefined) ?? null;
        }
        if ('selectedStems' in patch) {
          skipStemModelRef.current =
            (form.getFieldValue('modelName') as string | undefined) ?? null;
        }
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
              <>
                <Divider plain>分离参数</Divider>
                {msstCatalogError ? (
                  <Alert
                    type="error"
                    showIcon
                    message={msstCatalogError}
                    style={{ marginBottom: 12 }}
                  />
                ) : null}
                <SeparationModelPicker
                  catalog={msstCatalog}
                  modelName={modelNameValue}
                  downloads={msstDownloads}
                  onModelChange={handleSeparationModelChange}
                  onDownload={handleStartMsstDownload}
                  onCancel={handleCancelMsstDownload}
                />
                {currentMsstModel && !isMsstModelDownloaded ? (
                  <ModelDownloadProgress
                    download={currentMsstDownload}
                    className="separation-download-progress"
                  />
                ) : null}
                {currentMsstModel && currentMsstDownload?.status === 'error' ? (
                  <Alert
                    type="error"
                    showIcon
                    message={currentMsstDownload.message ?? '下载失败'}
                    style={{ marginBottom: 12 }}
                  />
                ) : null}
                {isSeparationModelReady ? (
                  <>
                    <Divider plain>输出参数</Divider>
                    <div className="audio-param-fields">
                      {[
                        ...nonAudioInputFields
                          .filter((field) => field.name === 'device')
                          .map((field) => resolveField(field)),
                        ...nonAudioOutputFields,
                      ].map((field) => (
                        <FieldItem key={field.name} field={field} fill />
                      ))}
                    </div>
                    <div className="separation-stem-field">
                      <Form.Item
                        name="selectedStems"
                        label="输出音轨"
                        tooltip="默认勾选全部；取消勾选可只输出个别音轨"
                        extra={
                          selectedStemOptions.length === 0
                            ? '该模型暂无音轨清单'
                            : '取消勾选可只输出个别音轨'
                        }
                      >
                        <Checkbox.Group
                          disabled={selectedStemOptions.length === 0}
                          options={selectedStemOptions.map((option) => ({
                            label: option.label,
                            value: option.value,
                          }))}
                        />
                      </Form.Item>
                    </div>
                    {currentMsstModel?.paramCapabilities?.chunkSize === false ? (
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
                            <FieldItem
                              key={field.name}
                              field={resolveAdvancedField(field)}
                              fill
                            />
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
                  </>
                ) : null}
              </>
            ) : (
              <>
                {nonAudioInputFields.length > 0 ? (
                  <div className="audio-param-fields">
                    {nonAudioInputFields.map((field) => (
                      <FieldItem key={field.name} field={resolveField(field)} fill />
                    ))}
                  </div>
                ) : null}
                {nonAudioAdvancedFields.length > 0 ? (
                  <>
                    <Divider plain>高级推理参数（留空使用模型默认）</Divider>
                    <div className="audio-param-fields">
                      {nonAudioAdvancedFields.map((field) => (
                        <FieldItem key={field.name} field={field} fill />
                      ))}
                    </div>
                  </>
                ) : null}
                {attachments.length > 1 ? (
                  <Alert
                    type="warning"
                    showIcon
                    title="当前仅支持单个文件"
                    description="当前功能严格只处理单个文件，将使用第一个已添加文件。"
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
              disabled={
                taskPending ||
                !isTaskIntent ||
                (isSeparation && !isSeparationModelReady)
              }
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
