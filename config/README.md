# 配置目录

`config/` 存放 WaveBank Otakus 的运行配置：

| 文件 | 用途 | 是否入库 |
| --- | --- | --- |
| `defaults.json` | 项目默认配置，随版本更新 | 是 |
| `settings.json` | 用户在设置界面保存后的覆盖配置 | 否（首次保存自动生成） |

后端启动时会把 `defaults.json` 与 `settings.json` 合并，`settings.json`
只保存与默认值不同的字段，方便后续版本升级默认配置。

`.env` 只作为本地开发期的临时环境变量入口，不属于用户配置体系。用户在设置页
保存的 API Key、ffmpeg 路径、输出目录等项目级配置，都以 `settings.json`
为准。

如需把配置目录改到其他位置，可设置环境变量：

```bash
export WAVEBANK_SETTINGS_PATH=/absolute/path/to/settings.json
```

Windows PowerShell：

```powershell
$env:WAVEBANK_SETTINGS_PATH = "D:\path\to\settings.json"
```

## ffmpeg 路径策略

后端默认使用项目内置 ffmpeg。可执行文件固定从版本源码目录自动定位：

```text
backend/vendor/ffmpeg/ffmpeg-<version>/ffmpeg(.exe)
backend/vendor/ffmpeg/ffmpeg-<version>/ffprobe(.exe)
```

路径策略如下：

- `ffmpeg.executable_path`：可选的自定义 `ffmpeg` 可执行文件绝对路径；
  后端会从同目录查找 `ffprobe`；
- 如果该字段为空，后端使用项目内置版本，不依赖系统 PATH。

需要使用项目内置版本时，后端启动会检测内置 ffmpeg；缺少源码时会按
`source_version` 自动下载源码，缺少二进制时会自动执行
`backend/vendor/ffmpeg/build-ffmpeg.sh`（Windows 使用 `build-ffmpeg.ps1`），
并在版本源码目录内生成 `ffmpeg` 与 `ffprobe`。
