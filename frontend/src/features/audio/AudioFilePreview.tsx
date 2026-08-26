import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Popover, Typography } from 'antd';
import {
  AudioOutlined,
  DownOutlined,
  FileAddOutlined,
  UpOutlined,
} from '@ant-design/icons';
import {
  getAudioInfo,
  getFileContentUrl,
  getFileStat,
  type AudioAnalysis,
  type AudioInfo,
  type FileStat,
} from '../../api/client';
import { formatFileSize, isVideoPath, pathBasename } from '../../utils/format';
import { PanelHeader } from '../layout/PanelHeader';
import { StyledMediaPlayer } from './StyledMediaPlayer';

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '-';
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return [hours, minutes, rest]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

interface AudioFilePreviewProps {
  path?: string;
  onPickFile?: () => void;
}

export function AudioFilePreview({
  path,
  onPickFile,
}: AudioFilePreviewProps) {
  const [stat, setStat] = useState<FileStat | null>(null);
  const [info, setInfo] = useState<AudioInfo | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setDetailsOpen(false);
    setStat(null);
    setInfo(null);
    setDetailsError(null);
    setDetailsLoading(false);
    if (!path) {
      return;
    }
    let cancelled = false;

    getFileStat(path)
      .then((result) => {
        if (!cancelled) {
          setStat(result);
        }
      })
      .catch(() => {
        // 文件信息拿不到时右上角回退显示路径与占位符。
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    if (!detailsOpen || !path || info) {
      return;
    }
    let cancelled = false;
    setDetailsError(null);
    setDetailsLoading(true);
    getAudioInfo(path)
      .then((result) => {
        if (!cancelled) {
          setInfo(result);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDetailsError(err instanceof Error ? err.message : '无法读取音频信息');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detailsOpen, info, path]);

  const handleDetailsOpenChange = (open: boolean) => {
    setDetailsOpen(open);
    if (open && path && !info) {
      setDetailsLoading(true);
    }
  };

  const contentUrl = path ? getFileContentUrl(path) : '';
  const hasVideo = isVideoPath(path ?? '');
  const stream = info?.streams.find((item) => item.codec_type === 'audio') ?? info?.streams[0];
  const analysis: Partial<AudioAnalysis> = info?.analysis ?? {};

  const items = path
    ? [
        { key: 'codec', label: '编码格式', children: stream?.codec_name || '-' },
        { key: 'sampleRate', label: '采样率', children: stream?.sample_rate ? `${stream.sample_rate} Hz` : '-' },
        { key: 'channels', label: '声道', children: stream?.channels ? `${stream.channels} ch` : '-' },
        {
          key: 'bitrate',
          label: '码率',
          children: info?.bit_rate ? `${(info.bit_rate / 1000).toFixed(0)} kbps` : '-',
        },
        {
          key: 'duration',
          label: '时长',
          children: info?.duration != null ? formatDuration(info.duration) : '-',
        },
        ...(info?.has_video
          ? []
          : [
              {
                key: 'peak',
                label: '峰值电平',
                children:
                  analysis.peak_dB != null
                    ? `${analysis.peak_dB.toFixed(2)} dB`
                    : '分析中/不可用',
              },
              {
                key: 'rms',
                label: 'RMS 电平',
                children:
                  analysis.rms_dB != null
                    ? `${analysis.rms_dB.toFixed(2)} dB`
                    : '分析中/不可用',
              },
              {
                key: 'dynamic',
                label: '动态范围',
                children:
                  analysis.dynamic_range_dB != null
                    ? `${analysis.dynamic_range_dB.toFixed(2)} dB`
                    : '分析中/不可用',
              },
              {
                key: 'loudness',
                label: '综合响度（LUFS）',
                children:
                  analysis.integrated_loudness_lufs != null
                    ? `${analysis.integrated_loudness_lufs.toFixed(1)} LUFS`
                    : '分析中/不可用',
              },
              {
                key: 'loudnessRange',
                label: '响度范围（LU）',
                children:
                  analysis.loudness_range_lu != null
                    ? `${analysis.loudness_range_lu.toFixed(1)} LU`
                    : '分析中/不可用',
              },
              {
                key: 'truePeak',
                label: '真峰值（dBTP）',
                children:
                  analysis.true_peak_dbtp != null
                    ? `${analysis.true_peak_dbtp.toFixed(1)} dBTP`
                    : '分析中/不可用',
              },
            ]),
      ]
    : [];

  return (
    <div className="audio-file-preview">
      {!path ? (
        <button type="button" className="audio-file-preview__empty" onClick={onPickFile}>
          <FileAddOutlined className="audio-file-preview__empty-icon" />
          <Typography.Text strong>点击选择本机音频/视频文件</Typography.Text>
          <Typography.Text type="secondary">支持常见音频与视频格式，仅处理单个文件</Typography.Text>
        </button>
      ) : (
        <>
          <div className="audio-file-preview__header">
            <PanelHeader icon={<AudioOutlined />}>已选文件</PanelHeader>
            <div className="audio-file-preview__header-meta">
              <Typography.Text
                ellipsis
                className="audio-file-preview__header-name"
                title={stat?.name ?? pathBasename(path)}
              >
                {stat?.name ?? pathBasename(path)}
              </Typography.Text>
              <span>{stat ? formatFileSize(stat.size) : '-'}</span>
              <Popover
                trigger="click"
                placement="bottomRight"
                open={detailsOpen}
                onOpenChange={handleDetailsOpenChange}
                content={
                  <div
                    style={{
                      maxWidth: 560,
                      maxHeight: 320,
                      overflow: 'auto',
                    }}
                  >
                    {!info ? (
                      detailsError ? (
                        <Alert type="warning" showIcon title={detailsError} />
                      ) : (
                        <Alert
                          type="info"
                          showIcon
                          title={
                            detailsLoading ? '正在分析音频详情…' : '准备分析音频详情…'
                          }
                          description="需要解码并计算响度，请稍候"
                        />
                      )
                    ) : (
                      <Descriptions
                        className="audio-file-preview__info"
                        size="small"
                        bordered
                        column={{ xs: 1, sm: 2 }}
                        items={items}
                      />
                    )}
                  </div>
                }
              >
                <Button
                  size="small"
                  className="audio-file-preview__summary-button"
                  icon={detailsOpen ? <UpOutlined /> : <DownOutlined />}
                >
                  {detailsOpen ? '收起详情' : '展开详情'}
                </Button>
              </Popover>
            </div>
          </div>
          <StyledMediaPlayer
            key={path}
            src={contentUrl}
            kind={hasVideo ? 'video' : 'audio'}
          />
        </>
      )}
    </div>
  );
}
