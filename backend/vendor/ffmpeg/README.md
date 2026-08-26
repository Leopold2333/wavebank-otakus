# 内置 ffmpeg（预编译包）

WaveBank Otakus 不再从源码编译 ffmpeg，而是按操作系统/架构使用
**预编译包**或系统已安装的 ffmpeg，避免用户安装 C 编译器、make 和一堆
开发库。release 列表解析、版本选择、下载、解压、校验、写配置全部由
Python 脚本完成，不依赖 curl/wget 或编译工具。

```text
backend/vendor/ffmpeg/
  latest/ 或 9.0.1/     # 预编译 ffmpeg / ffprobe：有明确版本号用版本目录，否则 latest/
  downloads/            # 下载的压缩包缓存
  download-ffmpeg.py    # 预编译包下载/检查脚本
  ffmpeg-9.0.1/         # （历史遗留）源码目录，不再参与启动构建
```

## 查找顺序

后端启动或执行音频任务时，按以下顺序寻找可用的 ffmpeg/ffprobe：

1. 设置页填写的自定义 `ffmpeg.executable_path`（同目录查找 `ffprobe`）；
2. 系统 PATH 中的 `ffmpeg`（同目录查找 `ffprobe`；macOS 额外探测
   `/opt/homebrew/bin`、`/usr/local/bin`，对应 `brew install ffmpeg`）；
3. 内置预编译包：`backend/vendor/ffmpeg/<版本号或 latest>/ffmpeg(.exe)`；
4. 都没有时，按 `config/defaults.json` 的 `ffmpeg.prebuilt_urls` 自动下载
   当前平台的预编译包；macOS 未配置默认下载地址，会提示用
   `brew install ffmpeg` 或填写自定义路径。

后端启动检查后会自动把实际使用的路径写入 `config/settings.json`：
检测到系统 ffmpeg 时写入 `ffmpeg.executable_path`，使用本地预编译包时
写入 `ffmpeg.prebuilt_installed_path`。

## 自动下载平台

默认配置已内置以下下载地址：

| 平台 | 默认来源 |
| --- | --- |
| Linux x86_64 / arm64 | BtbN/FFmpeg-Builds：`ffmpeg-master-latest-linux(arm)64-gpl.tar.xz` |
| Windows x86_64 | GyanD/codexffmpeg：先拉取 GitHub release 列表取最新版本号，再下载 `ffmpeg-<版本>-full_build.zip` |
| Windows arm64 | BtbN/FFmpeg-Builds：`ffmpeg-master-latest-winarm64-gpl.zip` |
| macOS | 未配置默认地址，推荐 `brew install ffmpeg` 后由 PATH 自动发现 |

可修改 `config/defaults.json` 中的 `ffmpeg.prebuilt_urls` 换成自己的镜像。
Windows 的 release 列表地址在 `ffmpeg.prebuilt_release_lists` 中配置。
下载的压缩包缓存在 `downloads/`，解压后的可执行文件放在
`<版本号>/`（下载地址里能解析出版本号时）或 `latest/`，均不会进入 git。

## 手动管理

```bash
python backend/vendor/ffmpeg/download-ffmpeg.py --check     # 检查当前平台
python backend/vendor/ffmpeg/download-ffmpeg.py --install   # 下载/安装
python backend/vendor/ffmpeg/download-ffmpeg.py --force     # 强制重新下载
```

## 使用指定 ffmpeg

前端「设置」页可以填写自定义 `ffmpeg` 可执行文件的绝对路径；
保存后会从同目录查找 `ffprobe`，保存后立即生效。
