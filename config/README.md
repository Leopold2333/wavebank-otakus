# 配置目录

`config/` 存放 WaveBank Otakus 的运行配置：

| 文件 | 用途 | 是否入库 |
| --- | --- | --- |
| `defaults.json` | 项目默认配置，随版本更新 | 是 |
| `settings.json` | 用户在设置界面保存后的覆盖配置 | 否（首次保存自动生成） |

后端启动时会把 `defaults.json` 与 `settings.json` 合并，`settings.json`
只保存与默认值不同的字段，方便后续版本升级默认配置。

如需把配置目录改到其他位置，可设置环境变量：

```bash
export WAVEBANK_SETTINGS_PATH=/absolute/path/to/settings.json
```

Windows PowerShell：

```powershell
$env:WAVEBANK_SETTINGS_PATH = "D:\path\to\settings.json"
```

## ffmpeg 路径策略

`ffmpeg.mode` 支持三种取值：

| mode | 行为 |
| --- | --- |
| `bundled`（默认） | 优先使用 `backend/vendor/ffmpeg/bin/ffmpeg(.exe)`；未构建时若 `fallback_to_system` 为 `true`，回退到系统 PATH |
| `system` | 直接使用系统 PATH 中的 `ffmpeg` / `ffprobe` |
| `custom` | 使用 `custom_ffmpeg_path` / `custom_ffprobe_path` 指定的可执行文件 |

后端启动时会检测 ffmpeg；内置模式缺少源码且 `auto_download_source` 为 `true`
时，会自动按 `source_version` 下载源码并解压到
`backend/vendor/ffmpeg/`，保留原始目录名。构建命令见
[backend/vendor/ffmpeg/README.md](../backend/vendor/ffmpeg/README.md)。
