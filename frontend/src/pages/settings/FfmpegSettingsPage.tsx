import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Space,
  Spin,
  Typography,
} from 'antd';
import {
  checkFfmpeg,
  getHealth,
  getSettings,
  saveFfmpegExecutablePath,
  saveSettings,
  type FfmpegCheckResult,
  type HealthResponse,
  type Settings,
} from '../../api/client';

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

export function FfmpegSettingsPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm<Settings>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingFfmpegPath, setSavingFfmpegPath] = useState(false);
  const [savedFfmpegPath, setSavedFfmpegPath] = useState('');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [checkResult, setCheckResult] = useState<FfmpegCheckResult | undefined>();
  const ffmpegExecutablePath = Form.useWatch(['ffmpeg', 'executable_path'], form);

  const applySettings = (settings: Settings) => {
    form.setFieldsValue(settings);
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

  if (loading) {
    return (
      <Spin description="正在加载设置…">
        <div style={{ minHeight: 240 }} />
      </Spin>
    );
  }

  const ffmpegInfo = checkResult ?? health?.ffmpeg;
  const bundledFfmpegDir =
    ffmpegInfo?.bundled_ffmpeg?.replace(/[/\\][^/\\]+$/, '') ??
    '/Users/gaobol/workspace/wavebank-otakus/backend/vendor/ffmpeg/latest';
  const normalizedFfmpegPath = String(ffmpegExecutablePath || '').trim();
  const isFfmpegPathDirty = normalizedFfmpegPath !== savedFfmpegPath;

  return (
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
              <Input allowClear placeholder={bundledFfmpegDir} />
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
    </Form>
  );
}
