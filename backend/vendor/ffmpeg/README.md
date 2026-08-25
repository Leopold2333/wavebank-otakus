# 内置 ffmpeg

WaveBank Otakus 将 ffmpeg 源码放在后端 vendor 目录，随项目一起分发，
避免用户依赖系统安装的 ffmpeg。后端默认配置（`config/defaults.json`）指向本目录
构建产物：

```text
backend/vendor/ffmpeg/
  bin/ffmpeg(.exe)      # 构建后的可执行文件
  bin/ffprobe(.exe)
  ffmpeg-9.0.1/         # 解压后的 ffmpeg 源码
  download-ffmpeg.py    # 内置下载脚本（保留压缩包原始目录名）
  build-ffmpeg.sh       # Linux / macOS / MSYS2 构建脚本
  build-ffmpeg.ps1      # Windows 调用 MSYS2 bash 的辅助脚本
```

## 自动检测与源码下载

后端启动时会检测 ffmpeg：

- 如果配置为 `bundled` 且 `bin/ffmpeg` 不存在，但已有解压源码，会提示执行构建脚本；
- 如果连源码都没有，且 `ffmpeg.auto_download_source` 为 `true`，会按
  `source_version` 自动下载 `ffmpeg-<version>.tar.xz` 并解压到本目录，
  **保留压缩包解压出的原始目录名**，不强制重命名。

也可以手动执行：

```bash
python download-ffmpeg.py --version 9.0.1
python download-ffmpeg.py --check
```

下载地址默认使用 `https://ffmpeg.org/releases/ffmpeg-{version}.tar.xz`，
可在设置页的「源码下载地址模板」中替换为镜像。

## 构建（Linux / macOS / MSYS2）

需要已安装 C 编译器、`make` 与基础构建工具：

```bash
cd backend/vendor/ffmpeg
chmod +x build-ffmpeg.sh
./build-ffmpeg.sh
```

构建完成后检查：

```bash
./bin/ffmpeg -version
./bin/ffprobe -version
```

## 构建（Windows）

1. 安装 [MSYS2](https://www.msys2.org/)，并在 MSYS2 中安装 `mingw-w64-x86_64-gcc`
   与 `make`；
2. 在 PowerShell 中执行：

```powershell
.\build-ffmpeg.ps1
```

脚本会调用 MSYS2 的 bash 执行 `build-ffmpeg.sh`，产物输出到 `bin/ffmpeg.exe`。

> 提示：默认构建为轻量音频场景（`--disable-network`、`--disable-programs`），
> 足以覆盖格式转换、音量、重采样、码率等音频处理；如需更多能力，可自行调整
> `build-ffmpeg.sh` 中的 configure 参数后重新构建。

## 使用系统 / 自定义 ffmpeg

打开前端「设置」页，将 ffmpeg 模式切换为：

- **系统 PATH**：直接使用系统已安装的 ffmpeg；
- **自定义路径**：填写 `ffmpeg.exe` / `ffprobe.exe` 的完整路径（Windows 也支持）。

保存后后端立即生效，无需重启。
