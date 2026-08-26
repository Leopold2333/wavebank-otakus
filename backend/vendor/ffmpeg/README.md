# 内置 ffmpeg

WaveBank Otakus 将 ffmpeg 源码放在后端 vendor 目录，随项目一起分发，
避免用户依赖系统安装的 ffmpeg。后端默认配置（`config/defaults.json`）
会自动定位版本源码目录里的可执行文件。

```text
backend/vendor/ffmpeg/
  ffmpeg-9.0.1/         # 解压后的 ffmpeg 源码，构建后包含 ffmpeg(.exe) / ffprobe(.exe)
  download-ffmpeg.py    # 内置下载脚本（保留压缩包原始目录名）
  build-ffmpeg.sh       # Linux / macOS / MSYS2 构建脚本
  build-ffmpeg.ps1      # Windows 调用 MSYS2 bash 的辅助脚本
```

## 自动检测、下载与构建

后端启动时会检测 ffmpeg：

- 使用 `ffmpeg.executable_path` 指向的自定义 `ffmpeg` 可执行文件，并从同目录
  查找 `ffprobe`；
- 如果 `ffmpeg.executable_path` 为空，则使用版本源码目录内的 `ffmpeg` 与
  `ffprobe`；
- 需要使用项目内置版本且源码不存在时，会按 `source_version` 自动下载
  `ffmpeg-<version>.tar.xz` 并解压到本目录，
  **保留压缩包解压出的原始目录名**，不强制重命名。
- 需要使用项目内置版本且源码就绪但二进制不存在时，会自动执行构建脚本，
  在版本源码目录内生成 `ffmpeg` 与 `ffprobe`，无需注册系统 PATH。

也可以手动执行：

```bash
python download-ffmpeg.py --version 9.0.1
python download-ffmpeg.py --build
python download-ffmpeg.py --check
```

下载地址默认使用 `https://ffmpeg.org/releases/ffmpeg-{version}.tar.xz`，
可在 `config/defaults.json` 中替换为镜像。

## 构建（Linux / macOS / MSYS2）

需要已安装 C 编译器、`make` 与基础构建工具：

```bash
cd backend/vendor/ffmpeg
chmod +x build-ffmpeg.sh
./build-ffmpeg.sh
```

构建完成后检查：

```bash
./ffmpeg-9.0.1/ffmpeg -version
./ffmpeg-9.0.1/ffprobe -version
```

## 构建（Windows）

1. 安装 [MSYS2](https://www.msys2.org/)，并在 MSYS2 中安装 `mingw-w64-x86_64-gcc`
   与 `make`；
2. 在 PowerShell 中执行：

```powershell
.\build-ffmpeg.ps1
```

脚本会调用 MSYS2 的 bash 执行 `build-ffmpeg.sh`，产物保留在版本源码目录内。

> 提示：默认构建为轻量音频场景（`--disable-network`、`--disable-programs`），
> 足以覆盖格式转换、音量、重采样、码率等音频处理；如需更多能力，可自行调整
> `build-ffmpeg.sh` 中的 configure 参数后重新构建。

## 使用指定 ffmpeg

前端「设置」页可以填写自定义 `ffmpeg` 可执行文件的绝对路径。
输入框占位提示会显示项目内置 ffmpeg 可执行文件的上一层目录；
保存后会从同目录查找 `ffprobe`。
保存后后端立即生效，无需重启。
