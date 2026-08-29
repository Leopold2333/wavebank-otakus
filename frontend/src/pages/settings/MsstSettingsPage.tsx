import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Collapse,
  Input,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import {
  removeMsstModel,
  type MsstCatalogCategory,
  type MsstDownloadState,
  type MsstModelInfo,
} from '../../api/client';
import { formatFileSize } from '../../utils/format';
import {
  ModelDownloadActions,
  ModelDownloadProgress,
} from '../../features/msst/ModelDownloadControls';
import { useMsstModelLibrary } from '../../features/msst/useMsstModelLibrary';

function formatModelName(name: string) {
  return name.replace(/\.(ckpt|th|pt|yaml)$/i, '');
}

function categoryKey(primary: MsstCatalogCategory, index: number) {
  return `${primary.primaryCategory}-${index}`;
}

function ModelRow({
  model,
  download,
  onDownload,
  onCancel,
  onRemove,
}: {
  model: MsstModelInfo;
  download: MsstDownloadState | undefined;
  onDownload: (model: MsstModelInfo) => void;
  onCancel: (model: MsstModelInfo) => void;
  onRemove: (model: MsstModelInfo) => void;
}) {
  const status = download?.status;
  const isDownloaded = model.downloaded || status === 'done';
  const isDownloading = status === 'downloading';
  const isCancelled = status === 'cancelled';

  return (
    <div className="msst-model-row">
      <div className="msst-model-row__main">
        <Space wrap size={4}>
          <Typography.Text strong>{formatModelName(model.name)}</Typography.Text>
          {model.architecture ? <Tag>{model.architecture}</Tag> : null}
          {model.sizeBytes > 0 ? <Tag>{formatFileSize(model.sizeBytes)}</Tag> : null}
          {isDownloaded ? (
            <Tag color="green">已下载</Tag>
          ) : isDownloading ? (
            <Tag color="processing">下载中</Tag>
          ) : isCancelled ? (
            <Tag>已取消</Tag>
          ) : (
            <Tag>未下载</Tag>
          )}
        </Space>
        <Space wrap size={12}>
          {model.targetStem ? (
            <Typography.Text type="secondary">
              目标音轨：{model.targetStem}
            </Typography.Text>
          ) : null}
          {model.primaryCategoryCn || model.secondaryCategoryCn ? (
            <Typography.Text type="secondary">
              {model.primaryCategoryCn} / {model.secondaryCategoryCn}
            </Typography.Text>
          ) : null}
        </Space>
        <Typography.Text
          type="secondary"
          className="msst-model-row__description"
        >
          {model.description || '暂无简介（待补充）'}
        </Typography.Text>
        <ModelDownloadProgress
          download={download}
          className="msst-model-row__progress"
        />
        {status === 'error' ? (
          <Alert type="error" showIcon message={download?.message ?? '下载失败'} />
        ) : null}
        {isCancelled ? (
          <Alert
            type="warning"
            showIcon
            message={download?.message ?? '下载已取消'}
          />
        ) : null}
      </div>
      <div className="msst-model-row__actions">
        {isDownloaded ? (
          <Popconfirm
            title="移除模型"
            description="会删除该模型在本地的全部缓存文件。"
            okText="移除"
            cancelText="取消"
            okType="danger"
            onConfirm={() => onRemove(model)}
          >
            <Button danger>移除</Button>
          </Popconfirm>
        ) : (
          <ModelDownloadActions
            model={model}
            download={download}
            onDownload={onDownload}
            onCancel={onCancel}
            buttonLabel="下载"
          />
        )}
      </div>
    </div>
  );
}

function ModelCategoryBrowser({
  title,
  models,
  downloads,
  onDownload,
  onCancel,
  onRemove,
}: {
  title: string;
  models: MsstModelInfo[];
  downloads: Record<string, MsstDownloadState>;
  onDownload: (model: MsstModelInfo) => void;
  onCancel: (model: MsstModelInfo) => void;
  onRemove: (model: MsstModelInfo) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [onlyDownloaded, setOnlyDownloaded] = useState(false);

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return models.filter((model) => {
      if (
        onlyDownloaded &&
        !model.downloaded &&
        downloads[model.name]?.status !== 'done'
      ) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        model.name,
        ...(model.aliases ?? []),
        model.architecture,
        model.modelType,
        model.targetStem,
        model.categoryPath,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [keyword, models, onlyDownloaded, downloads]);

  return (
    <div className="msst-category">
      <div className="msst-category__toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={`搜索 ${title}…`}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Space>
          <Switch checked={onlyDownloaded} onChange={setOnlyDownloaded} />
          <Typography.Text type="secondary">仅看已下载</Typography.Text>
        </Space>
      </div>
      <div className="msst-category__list">
        {filtered.length === 0 ? (
          <Typography.Text type="secondary">没有匹配的模型</Typography.Text>
        ) : (
          filtered.map((model) => (
            <ModelRow
              key={model.name}
              model={model}
              download={downloads[model.name]}
              onDownload={onDownload}
              onCancel={onCancel}
              onRemove={onRemove}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function MsstSettingsPage() {
  const { message } = App.useApp();
  const {
    catalog,
    catalogError: loadingError,
    catalogLoading: loading,
    downloads,
    loadCatalog,
    refreshDownloads,
    startDownload,
    cancelDownload,
  } = useMsstModelLibrary();

  const handleDownload = async (model: MsstModelInfo) => {
    try {
      await startDownload(model);
      message.open({
        type: 'success',
        content: `已开始下载 ${formatModelName(model.name)}`,
        className: 'settings-msst-message',
        style: { fontSize: 15, fontWeight: 500 },
      });
    } catch (error) {
      message.open({
        type: 'error',
        content: error instanceof Error ? error.message : '开始下载失败',
        className: 'settings-msst-message',
        style: { fontSize: 15, fontWeight: 500 },
      });
    }
  };

  const handleCancel = async (model: MsstModelInfo) => {
    try {
      const result = await cancelDownload(model);
      message.open({
        type: 'info',
        content: `已取消下载 ${formatModelName(model.name)}${
          result.cleaned?.length
            ? `，并清理 ${result.cleaned.length} 个残留文件`
            : '，并清理残留缓存'
        }`,
        className: 'settings-msst-message',
        style: { fontSize: 15, fontWeight: 500 },
      });
    } catch (error) {
      message.open({
        type: 'error',
        content: error instanceof Error ? error.message : '取消失败',
        className: 'settings-msst-message',
        style: { fontSize: 15, fontWeight: 500 },
      });
    }
  };

  const handleRemove = async (model: MsstModelInfo) => {
    try {
      const result = await removeMsstModel(model.name);
      await refreshDownloads();
      await loadCatalog();
      message.open({
        type: 'success',
        content:
          result.removed.length > 0
            ? `已移除 ${formatModelName(model.name)}（${result.removed.length} 个文件）`
            : `已移除 ${formatModelName(model.name)}`,
        className: 'settings-msst-message',
        style: { fontSize: 15, fontWeight: 500 },
      });
    } catch (error) {
      message.open({
        type: 'error',
        content: error instanceof Error ? error.message : '移除失败',
        className: 'settings-msst-message',
        style: { fontSize: 15, fontWeight: 500 },
      });
    }
  };

  if (loading) {
    return (
      <Spin description="正在加载模型库…">
        <div style={{ minHeight: 240 }} />
      </Spin>
    );
  }

  return (
    <div className="settings-msst">
      <Alert
        type="info"
        showIcon
        title="MSST 模型列表与下载服务"
        description="模型来自 pymss catalog，按主分类 / 次分类组织。每个分类都可搜索、只看已下载，并可选择模型开始后台下载；下载完成后模型会出现在对应任务页。"
        style={{ marginBottom: 12 }}
      />
      <Space style={{ marginBottom: 12 }} wrap>
        <Button icon={<ReloadOutlined />} onClick={() => void loadCatalog()}>
          刷新模型库
        </Button>
        <Typography.Text type="secondary">
          {catalog?.modelCount ?? 0} 个模型 / {catalog?.categories.length ?? 0} 个主分类
          {catalog?.source ? ` / 来源：${catalog.source}` : ''}
        </Typography.Text>
      </Space>
      {loadingError ? (
        <Alert type="error" showIcon message={loadingError} style={{ marginBottom: 12 }} />
      ) : null}
      <Collapse
        defaultActiveKey={[]}
        size="small"
        className="settings-msst__primary-collapse"
      >
        {catalog?.categories.map((primary) => (
          <Collapse.Panel
            key={primary.primaryCategory}
            header={`${primary.primaryCategoryCn}（${primary.secondaryCategories.reduce(
              (total, secondary) => total + secondary.models.length,
              0,
            )} 个模型）`}
          >
            <Collapse defaultActiveKey={[]} size="small">
              {primary.secondaryCategories.map((secondary, secondaryIndex) => (
                <Collapse.Panel
                  key={categoryKey(primary, secondaryIndex)}
                  header={`${secondary.secondaryCategoryCn}（${secondary.models.length} 个模型）`}
                >
                  <ModelCategoryBrowser
                    title={secondary.secondaryCategoryCn}
                    models={secondary.models}
                    downloads={downloads}
                    onDownload={handleDownload}
                    onCancel={handleCancel}
                    onRemove={handleRemove}
                  />
                </Collapse.Panel>
              ))}
            </Collapse>
          </Collapse.Panel>
        ))}
      </Collapse>
    </div>
  );
}
