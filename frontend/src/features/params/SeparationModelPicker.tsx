import { useMemo } from 'react';
import { Cascader } from 'antd';
import type {
  MsstCatalogCategory,
  MsstCatalogResponse,
  MsstDownloadState,
  MsstModelInfo,
} from '../../api/client';
import { ModelDownloadActions } from '../msst/ModelDownloadControls';

const SUPER_CATEGORIES: Array<{
  key: string;
  label: string;
  primaryKeys: string[];
}> = [
  {
    key: 'separation',
    label: '人声-伴奏类分离',
    primaryKeys: [
      'vocal',
      'legacy_vr',
      'legacy_models',
      'instrumental',
      'single_instrument',
      'karaoke',
      'spatial',
      'experimental_general',
      'music_stems',
      'special',
    ],
  },
  {
    key: 'post',
    label: '后处理类',
    primaryKeys: ['cleanup', 'reverb_echo_control'],
  },
];

const DEFAULT_SECONDARY_KEY = '__default__';

const PRIMARY_LABELS: Record<string, string> = {
  vocal: '人声',
  legacy_vr: '传统 VR 模型',
  legacy_models: '传统非 VR 模型',
  instrumental: '伴奏/无人声提取',
  single_instrument: '单乐器/单音轨',
  karaoke: '卡拉OK/和声',
  spatial: '声像/空间分离',
  experimental_general: '实验/通用分离',
  reverb_echo_control: '混响/回声处理',
  special: '特殊目标/差异提取',
  music_stems: '音乐多轨/分轨',
  cleanup: '音频清理/修复',
};

function primaryLabel(category: MsstCatalogCategory): string {
  return (
    category.primaryCategoryCn ||
    PRIMARY_LABELS[category.primaryCategory] ||
    category.primaryCategory
  );
}

function secondaryLabel(
  category: {
    secondaryCategory: string;
    secondaryCategoryCn: string;
  },
): string {
  return category.secondaryCategoryCn || category.secondaryCategory;
}

function superKeyForPrimary(primary?: string): string | null {
  if (!primary) {
    return null;
  }
  return (
    SUPER_CATEGORIES.find((superCategory) =>
      superCategory.primaryKeys.includes(primary),
    )?.key ?? null
  );
}

function formatModelName(name: string): string {
  return name.replace(/\.(ckpt|th|pt|yaml)$/i, '');
}

export function SeparationModelPicker({
  catalog,
  modelName,
  downloads,
  onModelChange,
  onDownload,
  onCancel,
}: {
  catalog: MsstCatalogResponse | null;
  modelName?: string;
  downloads: Record<string, MsstDownloadState>;
  onModelChange: (name: string | undefined) => void;
  onDownload: (model: MsstModelInfo) => void;
  onCancel: (model: MsstModelInfo) => void;
}) {
  const categories = catalog?.categories ?? [];
  const models = catalog?.models ?? [];

  const cascaderOptions = useMemo(
    () =>
      SUPER_CATEGORIES.map((superCategory) => ({
        value: superCategory.key,
        label: superCategory.label,
        searchText: superCategory.label,
        children: superCategory.primaryKeys
          .map((key) =>
            categories.find((category) => category.primaryCategory === key),
          )
          .filter((category): category is MsstCatalogCategory => Boolean(category))
          .map((primary) => ({
            value: primary.primaryCategory,
            label: primaryLabel(primary),
            searchText: `${primaryLabel(primary)} ${primary.primaryCategory}`,
            children: (primary.secondaryCategories ?? []).map((secondary) => ({
              value: secondary.secondaryCategory || DEFAULT_SECONDARY_KEY,
              label: secondaryLabel(secondary),
              searchText: `${secondaryLabel(secondary)} ${secondary.secondaryCategory}`,
              children: (secondary.models ?? []).map((model) => {
                const downloaded =
                  model.downloaded || downloads[model.name]?.status === 'done';
                return {
                  value: model.name,
                  label: formatModelName(model.name),
                  searchText: [
                    model.name,
                    ...(model.aliases ?? []),
                    model.architecture,
                    model.primaryCategoryCn,
                    model.secondaryCategoryCn,
                  ]
                    .filter(Boolean)
                    .join(' '),
                  downloaded,
                };
              }),
            })),
          })),
      })),
    [categories, downloads],
  );

  const cascaderValue = useMemo(() => {
    if (!modelName) {
      return undefined;
    }
    const model = models.find((item) => item.name === modelName);
    if (!model) {
      return undefined;
    }
    const superKey = superKeyForPrimary(model.primaryCategory);
    if (!superKey) {
      return undefined;
    }
    return [
      superKey,
      String(model.primaryCategory ?? ''),
      String(model.secondaryCategory || DEFAULT_SECONDARY_KEY),
      model.name,
    ];
  }, [modelName, models]);

  const selectedModel = models.find((model) => model.name === modelName) ?? null;
  const selectedDownload = selectedModel
    ? downloads[selectedModel.name]
    : undefined;
  const selectedDownloaded =
    selectedModel?.downloaded || selectedDownload?.status === 'done';

  const handleChange = (value?: (string | number)[]) => {
    if (value && value.length >= 4) {
      onModelChange(String(value[3]));
    } else {
      onModelChange(undefined);
    }
  };

  return (
    <div className="separation-model-picker">
      <Cascader
        className="separation-model-picker__cascader"
        placeholder="超大类 / 大类 / 任务小类 / 模型名称"
        options={cascaderOptions}
        value={cascaderValue}
        onChange={handleChange}
        onClear={() => onModelChange(undefined)}
        allowClear
        displayRender={(labels) => labels[labels.length - 1] ?? ''}
        showSearch={{
          filter: (inputValue, path) => {
            const query = inputValue.trim().toLowerCase();
            return path.some((option) => {
              const raw = option as {
                searchText?: unknown;
                label?: unknown;
              };
              const haystack = [raw?.searchText, raw?.label]
                .filter((part) => part != null)
                .map((part) => String(part).toLowerCase())
                .join(' ');
              return haystack.includes(query);
            });
          },
        }}
        optionRender={(option) => {
          const raw = option as unknown as {
            children?: unknown;
            downloaded?: boolean;
            label?: unknown;
          };
          const isModelLeaf = raw.children == null;
          return (
            <span
              className={
                isModelLeaf && raw.downloaded === false
                  ? 'msst-model-option msst-model-option--undownloaded'
                  : 'msst-model-option'
              }
            >
              {String(raw.label ?? '')}
            </span>
          );
        }}
      />
      {selectedModel && !selectedDownloaded ? (
        <div className="separation-model-picker__action">
          <ModelDownloadActions
            model={selectedModel}
            download={selectedDownload}
            onDownload={onDownload}
            onCancel={onCancel}
          />
        </div>
      ) : null}
    </div>
  );
}
