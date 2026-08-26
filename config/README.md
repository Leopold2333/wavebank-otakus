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

后端优先使用项目内置的预编译 ffmpeg，可执行文件按平台存放：

```text
backend/vendor/ffmpeg/<版本号或 latest>/ffmpeg(.exe)
backend/vendor/ffmpeg/<版本号或 latest>/ffprobe(.exe)
```

路径策略如下：

- `ffmpeg.executable_path`：可选的自定义 `ffmpeg` 可执行文件绝对路径；
  后端会从同目录查找 `ffprobe`；
  启动时若检测到系统 PATH 中的 ffmpeg 且此项为空，会自动写入系统 ffmpeg 路径；
- 如果该字段为空，依次检查系统 PATH（macOS 含 Homebrew 目录）、
  内置预编译包。

需要内置版本且本机没有时，后端启动会按 `ffmpeg.prebuilt_urls` 中当前平台
的地址自动下载预编译包并解压到 `backend/vendor/ffmpeg/<版本号>/`
（下载地址里没有明确版本号时用 `latest/`）；其中
Windows 的地址含 `{version}` 占位符，会先从
`ffmpeg.prebuilt_release_lists` 配置的 GitHub release 列表取最新版本号。
下载完成后会把实际路径写入 `ffmpeg.prebuilt_installed_path`（保存在
`config/settings.json`）。
