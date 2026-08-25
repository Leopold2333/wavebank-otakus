import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd';
import {
  checkFfmpeg,
  getHealth,
  getSettings,
  saveSettings,
  testAgentConnection,
  type AgentSettings,
  type FfmpegCheckResult,
  type HealthResponse,
  type Settings,
} from '../api/client';

const FFMPEG_MODE_OPTIONS = [
  { label: '内置 ffmpeg（默认）', value: 'bundled' },
  { label: '系统 PATH', value: 'system' },
  { label: '自定义路径', value: 'custom' },
];

const AGENT_PROVIDER_OPTIONS = [
  { label: 'DeepSeek（默认）', value: 'deepseek' },
  { label: 'Kimi / Moonshot', value: 'moonshot' },
  { label: '智谱 GLM', value: 'zhipu' },
  { label: '通义千问', value: 'qwen' },
  { label: '自定义 OpenAI 兼容接口', value: 'custom' },
];

const AGENT_PROVIDER_PRESETS: Record<
  NonNullable<AgentSettings['provider']>,
  { base_url: string; model: string }
> = {
  deepseek: { base_url: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  moonshot: { base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  zhipu: { base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  qwen: {
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  custom: { base_url: '', model: '' },
};

function FfmpegStatus({ info }: { info: FfmpegCheckResult | undefined }) {
  if (!info) {
    return null;
  }
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
          </>
        }
      />
    );
  }
  return <Alert type="error" showIcon title="ffmpeg 不可用" description={info.error} />;
}

export function SettingsPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm<Settings>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [agentTesting, setAgentTesting] = useState(false);
  const [agentTestResult, setAgentTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [checkResult, setCheckResult] = useState<FfmpegCheckResult | undefined>();

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
        form.setFieldsValue(settingsResponse.settings);
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
      const result = await checkFfmpeg({ ffmpeg: values.ffmpeg });
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
      form.setFieldsValue(response.settings);
      setCheckResult(response.ffmpeg);
      message.success(`配置已保存到 ${response.settings_path}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
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
              name={['ffmpeg', 'mode']}
              label="ffmpeg 来源"
              extra="内置模式优先使用项目自带 ffmpeg；未构建时可按下面的开关回退到系统 PATH。"
            >
              <Select options={FFMPEG_MODE_OPTIONS} />
            </Form.Item>

            <Form.Item
              noStyle
              shouldUpdate={(prev, next) => prev.ffmpeg?.mode !== next.ffmpeg?.mode}
            >
              {({ getFieldValue }) =>
                getFieldValue(['ffmpeg', 'mode']) === 'custom' ? (
                  <>
                    <Form.Item
                      className="settings-grid__wide"
                      name={['ffmpeg', 'custom_ffmpeg_path']}
                      label="ffmpeg 可执行文件路径"
                      rules={[{ required: true, message: '请填写 ffmpeg 路径' }]}
                    >
                      <Input placeholder="/usr/bin/ffmpeg 或 C:\ffmpeg\bin\ffmpeg.exe" />
                    </Form.Item>
                    <Form.Item
                      className="settings-grid__wide"
                      name={['ffmpeg', 'custom_ffprobe_path']}
                      label="ffprobe 可执行文件路径（可选）"
                      extra="留空时会尝试从 ffmpeg 同目录自动推断，或回退到系统 PATH。"
                    >
                      <Input placeholder="/usr/bin/ffprobe 或 C:\ffmpeg\bin\ffprobe.exe" />
                    </Form.Item>
                  </>
                ) : null
              }
            </Form.Item>

            <Form.Item
              name={['ffmpeg', 'fallback_to_system']}
              label="内置 ffmpeg 不可用时回退到系统 PATH"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name={['ffmpeg', 'auto_download_source']}
              label="缺少内置 ffmpeg 源码时自动下载"
              valuePropName="checked"
              extra="后端启动时会检测 ffmpeg；内置模式且没有可用二进制/源码时，按下方版本与地址自动下载源码并解压。"
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name={['ffmpeg', 'source_version']}
              label="内置 ffmpeg 源码版本"
              extra="仅影响自动下载；解压后保留原始目录名，不强制重命名。"
            >
              <Input placeholder="9.0.1" />
            </Form.Item>

            <Form.Item
              className="settings-grid__wide"
              name={['ffmpeg', 'download_url_template']}
              label="源码下载地址模板"
              extra="支持 {version} 占位符，例如 https://mirror.example.com/ffmpeg-{version}.tar.xz"
            >
              <Input placeholder="https://ffmpeg.org/releases/ffmpeg-{version}.tar.xz" />
            </Form.Item>

            <Form.Item
              name={['ffmpeg', 'timeout_seconds']}
              label="ffmpeg 任务超时（秒）"
              extra="超过该时长后任务会终止并标记失败。"
            >
              <InputNumber min={60} max={86400} step={60} />
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
            <Button loading={agentTesting} onClick={() => void handleTestAgent()}>
              测试连接
            </Button>
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
                    {form.getFieldValue(['agent', 'api_key_source']) === 'env' ? (
                      <Tag color="blue">来自 .env</Tag>
                    ) : form.getFieldValue(['agent', 'api_key_source']) ===
                      'settings' ? (
                      <Tag color="green">已加密保存</Tag>
                    ) : (
                      <Tag>未配置</Tag>
                    )}
                  </Space>
                  <div>
                    Key 仅保存在本机配置中（加密存储），不会明文回传前端；也可在项目根目录
                    .env 中配置 DEEPSEEK_API_KEY 作为开发期兜底。
                  </div>
                </>
              }
            >
              <Input.Password
                placeholder="sk-…（留空则清除已保存 Key，未填写时回退到 .env）"
                autoComplete="new-password"
              />
            </Form.Item>

            <Form.Item
              name={['agent', 'provider']}
              label="平台 / 供应商"
              extra="国内平台统一走 OpenAI 兼容的 chat completions 接口。"
            >
              <Select
                options={AGENT_PROVIDER_OPTIONS}
                onChange={(value: NonNullable<AgentSettings['provider']>) => {
                  const preset = AGENT_PROVIDER_PRESETS[value];
                  const current = form.getFieldValue('agent') as
                    | Partial<AgentSettings>
                    | undefined;
                  form.setFieldsValue({
                    agent: {
                      ...(current ?? {}),
                      base_url: preset.base_url,
                      model: preset.model,
                    },
                  });
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
              <Input placeholder="https://api.deepseek.com" />
            </Form.Item>

            <Form.Item
              name={['agent', 'model']}
              label="默认模型（只读）"
              extra="模型与推理强度已在 Agent 对话框中按次选择，这里仅保留默认值。"
            >
              <Input disabled placeholder="deepseek-v4-flash" />
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
        <FfmpegStatus info={checkResult ?? health?.ffmpeg} />
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
