import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  checkFfmpeg,
  getAgentModels,
  getHealth,
  getSettings,
  saveFfmpegExecutablePath,
  saveSettings,
  testAgentConnection,
  type AgentSettings,
  type AgentModelInfo,
  type FfmpegCheckResult,
  type HealthResponse,
  type Settings,
} from '../api/client';

const AGENT_PROVIDER_OPTIONS = [
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Kimi / Moonshot', value: 'moonshot' },
  { label: '智谱 GLM', value: 'zhipu' },
  { label: '通义千问', value: 'qwen' },
  { label: '自定义 OpenAI 兼容接口', value: 'custom' },
];

const AGENT_PROVIDER_PRESETS: Record<
  Exclude<AgentSettings['provider'], ''>,
  { base_url: string }
> = {
  deepseek: { base_url: 'https://api.deepseek.com' },
  moonshot: { base_url: 'https://api.moonshot.cn/v1' },
  zhipu: { base_url: 'https://open.bigmodel.cn/api/paas/v4' },
  qwen: {
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  custom: { base_url: '' },
};

function FfmpegStatus({ info }: { info: FfmpegCheckResult | undefined }) {
  if (!info) {
    return null;
  }
  const bundledPaths = (
    <>
      {info.bundled_ffmpeg ? <div>内置 ffmpeg：{info.bundled_ffmpeg}</div> : null}
      {info.bundled_ffprobe ? <div>内置 ffprobe：{info.bundled_ffprobe}</div> : null}
    </>
  );
  if (info.ok) {
    return (
      <Alert
        type="success"
        showIcon
        title="ffmpeg 可用"
        description={
          <>
            <div>路径：{info.ffmpeg}</div>
            {info.ffprobe ? <div>ffprobe：{info.ffprobe}</div> : null}
            {info.version ? <div>{info.version}</div> : null}
            <div>来源：{info.source}</div>
            {bundledPaths}
          </>
        }
      />
    );
  }
  return (
    <Alert
      type="error"
      showIcon
      title="ffmpeg 不可用"
      description={
        <>
          <div>{info.error}</div>
          {bundledPaths}
        </>
      }
    />
  );
}

export function SettingsPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm<Settings>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingFfmpegPath, setSavingFfmpegPath] = useState(false);
  const [agentTesting, setAgentTesting] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  const [clearingAgent, setClearingAgent] = useState(false);
  const [savingAgentModel, setSavingAgentModel] = useState(false);
  const [loadingAgentModels, setLoadingAgentModels] = useState(false);
  const [agentModelsEnabled, setAgentModelsEnabled] = useState(false);
  const [agentModels, setAgentModels] = useState<AgentModelInfo[]>([]);
  const [savedFfmpegPath, setSavedFfmpegPath] = useState('');
  const [agentTestResult, setAgentTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [checkResult, setCheckResult] = useState<FfmpegCheckResult | undefined>();
  const ffmpegExecutablePath = Form.useWatch(['ffmpeg', 'executable_path'], form);
  const agentSettings = Form.useWatch('agent', form);
  const hasAgentConfig = Boolean(
    String(agentSettings?.api_key || '').trim() ||
      agentSettings?.api_key_configured ||
      agentSettings?.provider ||
      String(agentSettings?.base_url || '').trim() ||
      String(agentSettings?.model || '').trim() ||
      (agentSettings?.models?.length ?? 0) > 0,
  );

  const canUseAgentModels = (agent: Partial<AgentSettings> | undefined) =>
    Boolean(agent?.api_key_configured && agent.provider && agent.base_url);

  const resetAgentModelChoices = () => {
    setAgentModelsEnabled(false);
    setAgentModels([]);
    form.setFieldValue(['agent', 'model'], '');
    form.setFieldValue(['agent', 'models'], []);
  };

  const refreshAgentModels = async (
    settings: Settings,
    options: { showError?: boolean } = {},
  ) => {
    if (!canUseAgentModels(settings.agent)) {
      setAgentModelsEnabled(false);
      setAgentModels([]);
      form.setFieldValue(['agent', 'models'], []);
      return false;
    }
    setLoadingAgentModels(true);
    try {
      const response = await getAgentModels();
      const defaultModel =
        response.default_model || (!response.error ? response.models[0]?.id : '') || '';
      setAgentModels(response.models);
      form.setFieldValue(['agent', 'models'], response.models);
      form.setFieldValue(['agent', 'model'], defaultModel);
      setAgentModelsEnabled(response.models.length > 0);
      if (response.error && (options.showError ?? true)) {
        message.warning(response.error);
      }
      return !response.error;
    } catch (error) {
      setAgentModels([]);
      form.setFieldValue(['agent', 'models'], []);
      setAgentModelsEnabled(false);
      if (options.showError ?? true) {
        message.error(error instanceof Error ? error.message : '获取模型列表失败');
      }
      return false;
    } finally {
      setLoadingAgentModels(false);
    }
  };

  const applySettings = (settings: Settings) => {
    const models = settings.agent.models ?? [];
    form.setFieldsValue(settings);
    setAgentModels(models);
    setAgentModelsEnabled(canUseAgentModels(settings.agent) && models.length > 0);
    setSavedFfmpegPath(String(settings.ffmpeg.executable_path || '').trim());
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [settingsResponse, healthResponse] = await Promise.all([
          getSettings(),
          getHealth(),
        ]);
        if (!mounted) {
          return;
        }
        applySettings(settingsResponse.settings);
        await refreshAgentModels(settingsResponse.settings);
        setHealth(healthResponse);
      } catch (error) {
        if (mounted) {
          message.error(error instanceof Error ? error.message : '加载设置失败');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [form, message]);

  const handleTest = async () => {
    setTesting(true);
    try {
      const values = await form.validateFields();
      const result = await checkFfmpeg({
        ffmpeg: values.ffmpeg,
      });
      setCheckResult(result.ffmpeg);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '检测失败');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (values: Settings) => {
    setSaving(true);
    try {
      const response = await saveSettings(values);
      applySettings(response.settings);
      await refreshAgentModels(response.settings);
      setCheckResult(response.ffmpeg);
      message.success(`配置已保存到 ${response.settings_path}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveFfmpegPath = async () => {
    setSavingFfmpegPath(true);
    try {
      await form.validateFields([['ffmpeg', 'executable_path']]);
      const executablePath = String(
        form.getFieldValue(['ffmpeg', 'executable_path']) || '',
      ).trim();
      const response = await saveFfmpegExecutablePath(executablePath);
      applySettings(response.settings);
      setCheckResult(response.ffmpeg);
      message.success('ffmpeg 路径已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存 ffmpeg 路径失败');
    } finally {
      setSavingFfmpegPath(false);
    }
  };

  const handleSaveAgent = async () => {
    setSavingAgent(true);
    try {
      await form.validateFields([
        ['agent', 'api_key'],
        ['agent', 'provider'],
        ['agent', 'base_url'],
        ['agent', 'timeout_seconds'],
      ]);
      const values = form.getFieldsValue(true) as Settings;
      const agent = values.agent;
      if (!String(agent.api_key || '').trim() && !agent.api_key_configured) {
        throw new Error('请先填写 API Key');
      }
      if (!agent.provider) {
        throw new Error('请先选择平台 / 供应商');
      }
      if (!String(agent.base_url || '').trim()) {
        throw new Error('请先填写接口地址');
      }
      const response = await saveSettings(values);
      applySettings(response.settings);
      const modelsReady = await refreshAgentModels(response.settings);
      message.success(
        modelsReady ? 'Agent 配置已保存，模型列表已更新' : 'Agent 配置已保存',
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存 Agent 配置失败');
    } finally {
      setSavingAgent(false);
    }
  };

  const handleSaveAgentModel = async (model: string) => {
    setSavingAgentModel(true);
    try {
      form.setFieldValue(['agent', 'model'], model);
      const values = form.getFieldsValue(true) as Settings;
      const response = await saveSettings(values);
      applySettings(response.settings);
      message.success('默认模型已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存默认模型失败');
    } finally {
      setSavingAgentModel(false);
    }
  };

  const handleClearAgent = async () => {
    setClearingAgent(true);
    try {
      const response = await saveSettings({ agent: null });
      applySettings(response.settings);
      setAgentTestResult(null);
      message.success('LLM 配置已清除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '清除 LLM 配置失败');
    } finally {
      setClearingAgent(false);
    }
  };

  const handleTestAgent = async () => {
    const values = await form.validateFields();
    setAgentTesting(true);
    setAgentTestResult(null);
    try {
      const result = await testAgentConnection(values.agent);
      setAgentTestResult({
        ok: true,
        text: `连接成功：${result.reply || 'OK'}（${result.model ?? ''}，${result.latency_ms ?? '-'} ms）`,
      });
    } catch (error) {
      setAgentTestResult({
        ok: false,
        text: error instanceof Error ? error.message : '连接测试失败',
      });
    } finally {
      setAgentTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-page">
        <Spin description="正在加载设置…">
          <div style={{ minHeight: 240 }} />
        </Spin>
      </div>
    );
  }

  const ffmpegInfo = checkResult ?? health?.ffmpeg;
  const bundledFfmpegDir =
    ffmpegInfo?.bundled_ffmpeg?.replace(/[/\\][^/\\]+$/, '') ??
    '/Users/gaobol/workspace/wavebank-otakus/backend/vendor/ffmpeg/latest';
  const normalizedFfmpegPath = String(ffmpegExecutablePath || '').trim();
  const isFfmpegPathDirty = normalizedFfmpegPath !== savedFfmpegPath;

  return (
    <div className="settings-page">
      <Form form={form} layout="vertical" onFinish={handleSave}>
        <Card
          title="ffmpeg"
          extra={
            <Button loading={testing} onClick={handleTest}>
              测试当前配置
            </Button>
          }
        >
          <div className="settings-grid">
            <Form.Item
              className="settings-grid__wide"
              name={['ffmpeg', 'executable_path']}
              label="自定义 ffmpeg 绝对路径"
              extra="留空则使用项目内置 ffmpeg；填写后会从同目录查找 ffprobe。"
              rules={[
                {
                  validator: async (_, value) => {
                    const trimmed = String(value || '').trim();
                    if (!trimmed) {
                      return;
                    }
                    const isUnixAbsolute = trimmed.startsWith('/');
                    const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(trimmed);
                    if (!isUnixAbsolute && !isWindowsAbsolute) {
                      throw new Error('请填写 ffmpeg 可执行文件的绝对路径');
                    }
                  },
                },
              ]}
            >
              <Space.Compact block>
                <Input
                  allowClear
                  placeholder={bundledFfmpegDir}
                />
                <Button
                  type="primary"
                  htmlType="button"
                  loading={savingFfmpegPath}
                  disabled={!isFfmpegPathDirty}
                  onClick={() => void handleSaveFfmpegPath()}
                >
                  保存
                </Button>
              </Space.Compact>
            </Form.Item>
          </div>
        </Card>

        <Card title="路径与并发">
          <div className="settings-grid">
            <Form.Item
              name={['paths', 'output_dir']}
              label="任务输出目录"
              extra="相对路径基于项目根目录。"
            >
              <Input placeholder="outputs" />
            </Form.Item>
            <Form.Item
              name={['paths', 'tmp_dir']}
              label="任务临时目录"
              extra="每个任务会在此目录下创建以任务 ID 命名的独立子目录。"
            >
              <Input placeholder="tmp" />
            </Form.Item>
            <Form.Item
              name={['tasks', 'max_workers']}
              label="ffmpeg 并发任务数"
              extra="同一时间最多同时运行多少个 ffmpeg 任务。"
            >
              <InputNumber min={1} max={16} />
            </Form.Item>
          </div>
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>
              保存配置
            </Button>
            <Button loading={testing} onClick={handleTest}>
              测试 ffmpeg
            </Button>
          </Space>
        </Card>

        <Card
          title="Agent"
          extra={
            <Space>
              <Button
                loading={agentTesting}
                disabled={clearingAgent}
                onClick={() => void handleTestAgent()}
              >
                测试连接
              </Button>
              <Popconfirm
                title="清除 LLM 配置"
                description="会清除已保存的 API Key、供应商、接口地址和模型配置。"
                okText="清除"
                cancelText="取消"
                okType="danger"
                disabled={!hasAgentConfig || savingAgent || clearingAgent}
                onConfirm={() => void handleClearAgent()}
              >
                <Button
                  danger
                  htmlType="button"
                  loading={clearingAgent}
                  disabled={!hasAgentConfig || savingAgent || agentTesting}
                >
                  清除配置
                </Button>
              </Popconfirm>
              <Button
                type="primary"
                htmlType="button"
                loading={savingAgent}
                disabled={clearingAgent}
                onClick={() => void handleSaveAgent()}
              >
                保存配置
              </Button>
            </Space>
          }
        >
          <div className="settings-grid">
            <Form.Item
              className="settings-grid__wide"
              name={['agent', 'api_key']}
              label="API Key"
              extra={
                <>
                  <Space>
                    {agentSettings?.api_key_source === 'env' ? (
                      <Tag color="blue">开发环境变量</Tag>
                    ) : agentSettings?.api_key_source === 'settings' ? (
                      <Tag color="green">已加密保存</Tag>
                    ) : (
                      <Tag>未配置</Tag>
                    )}
                  </Space>
                  <div>
                    用户配置只保存在本机配置文件中（加密存储），不会明文回传前端。
                    开发期环境变量只作为后端兜底，不会填入这个输入框。
                  </div>
                </>
              }
            >
              <Input.Password
                placeholder="sk-…（留空则清除已保存 Key）"
                autoComplete="new-password"
                onChange={resetAgentModelChoices}
              />
            </Form.Item>

            <Form.Item
              name={['agent', 'provider']}
              label="平台 / 供应商"
              extra="国内平台统一走 OpenAI 兼容的 chat completions 接口。"
            >
              <Select
                allowClear
                placeholder="请选择平台"
                options={AGENT_PROVIDER_OPTIONS}
                onChange={(value?: AgentSettings['provider']) => {
                  const current = form.getFieldValue('agent') as
                    | Partial<AgentSettings>
                    | undefined;
                  const preset = value ? AGENT_PROVIDER_PRESETS[value] : undefined;
                  form.setFieldsValue({
                    agent: {
                      ...(current ?? {}),
                      provider: value ?? '',
                      base_url: preset?.base_url ?? '',
                      model: '',
                      models: [],
                    },
                  });
                  setAgentModelsEnabled(false);
                  setAgentModels([]);
                }}
              />
            </Form.Item>

            <Form.Item name={['agent', 'timeout_seconds']} label="请求超时（秒）">
              <InputNumber min={10} max={600} step={10} />
            </Form.Item>

            <Form.Item
              className="settings-grid__wide"
              name={['agent', 'base_url']}
              label="接口地址（base_url）"
              extra="使用 OpenAI 兼容的 /v1 或厂商文档给出的 base_url。"
            >
              <Input
                placeholder="选择平台后自动填写，或手动输入 OpenAI 兼容 base_url"
                onChange={resetAgentModelChoices}
              />
            </Form.Item>

            <Form.Item
              name={['agent', 'model']}
              label="默认模型"
              extra="保存 Agent 配置后，会从当前 base_url 获取可用模型。"
            >
              <Select
                showSearch={{ optionFilterProp: 'label' }}
                disabled={!agentModelsEnabled}
                loading={loadingAgentModels || savingAgentModel}
                placeholder={
                  agentModelsEnabled
                    ? '请选择默认模型'
                    : '保存 API Key、平台和接口地址后可选择'
                }
                options={agentModels.map((item) => ({
                  label: item.id,
                  value: item.id,
                }))}
                notFoundContent={
                  loadingAgentModels ? '正在获取模型列表' : '暂无可用模型'
                }
                onChange={(value) => void handleSaveAgentModel(value)}
              />
            </Form.Item>
          </div>

          {agentTestResult ? (
            <Alert
              type={agentTestResult.ok ? 'success' : 'error'}
              showIcon
              title={agentTestResult.ok ? '连接测试通过' : '连接测试失败'}
              description={agentTestResult.text}
              style={{ marginTop: 8, maxWidth: 640 }}
            />
          ) : null}
        </Card>
      </Form>

      <Card title="状态">
        <FfmpegStatus info={ffmpegInfo} />
        {health ? (
          <Space orientation="vertical" style={{ marginTop: 12 }}>
            <Typography.Text type="secondary">
              运行平台：{health.platform.system} / {health.platform.machine}
            </Typography.Text>
            <Typography.Text type="secondary">
              配置文件目录：{health.config_dir}
            </Typography.Text>
          </Space>
        ) : null}
      </Card>
    </div>
  );
}
