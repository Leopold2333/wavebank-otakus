# WaveBank Otakus（音波库）

本地部署的 WebUI 音频媒体处理平台：以 Agent 智能体为主驾驶，配合人工参数窗进行精细控制。

详细需求与实现方案见：

- [需求文档](docs/plan.md)
- [前端方案](docs/frontend/plan.md)
- [后端方案](docs/backend/plan.md)

## 一键启动

项目根目录提供跨平台统一启动器，一个命令同时启动 Flask 后端和 Vite 前端：

```bash
python start.py
```

Windows 也可以双击/执行 `start.bat`，Linux/macOS 也可以执行 `./start.sh`。
启动器会自动完成：

- 使用 `uv sync --locked` 同步 `backend/uv.lock` 到 `backend/.venv`；
- 前端缺少 `node_modules` 时自动执行 `npm install`；
- 启动后端 `127.0.0.1:5000` 和前端 `127.0.0.1:5173`；
- 等待前后端就绪后自动打开浏览器；
- 按 `Ctrl+C` 同时关闭前后端进程。

可选参数：

```bash
python start.py --no-browser   # 不自动打开浏览器
python start.py --no-install   # 跳过自动依赖安装
```

## 前端开发

```bash
cd frontend
npm install
npm run dev
```

开发服务器默认监听 `0.0.0.0:5173`，便于从 WSL 宿主机 Windows 浏览器访问；`/api` 仍代理到 `http://127.0.0.1:5000`。

在 WSL 中启动后，Windows 浏览器访问 `http://localhost:5173`；若 WSL2 的 localhost 转发未生效，则访问 WSL IP（在 WSL 内执行 `hostname -I` 获取），例如 `http://<WSL-IP>:5173`。

当前已包含：

- Vite + React + TypeScript + Ant Design v6 工程骨架
- 可折叠侧边栏（左上角图标 + 平台名，收缩后仅保留图标）
- Agent 工作台：上方人工参数窗 + 下方 Agent 对话栏
- 任务分类按钮 → 意图路由 → 对应配置窗默认折叠加载
- Agent 对话本地意图路由演示（后续接入 `/api/agents/chat`）
- 统一文件附件状态：Agent 对话栏「添加本机文件」直接引用后端宿主机路径，人工参数窗同步展示并自动填入音频任务的输入文件
- 参数窗输入框支持打开本机文件浏览器，直接选择后端宿主机的绝对路径
- 音频处理二级页面：格式转换、视频提取音频、音频裁切、变速变调、背景去噪；顶部内置播放器与编码/采样率/时长/峰值电平/动态范围信息面板
- 输出参数统一多列布局：输出格式、音量、响度、真峰值、声道、采样率、码率
- 任务中心通过 SSE 实时刷新任务进度、日志、命令、临时目录与产物

## 后端开发

后端使用 Flask + LangGraph，当前已包含：

- 配置持久化：`config/settings.json`（用户覆盖项）与 `config/defaults.json`（项目默认值）
- ffmpeg/ffprobe 封装：安全参数列表调用、进度解析、日志归档、任务取消
- ffmpeg 启动检测与预编译包管理：按平台自动下载/解压预编译 ffmpeg 到 `backend/vendor/ffmpeg/<版本号或 latest>/`，缺省时回退使用系统 PATH 中的 ffmpeg
- 音频处理 LangGraph 工作流：五个二级功能各自独立封装为一张完整图（collect_params → probe_validate → execute → verify → summarize），并由父图 `router.py` 以“编译子图节点”的方式路由，见 `backend/workflows/audio/`
- 音频二级任务类型：audio.convert / audio.extract / audio.trim / audio.pitch / audio.denoise，Schema 与任务接口已按二级类型隔离
- 音频二级功能已接入真实 ffmpeg 命令：格式转换、视频提取音频、音频裁切、变速变调、背景去噪（afftdn）
- 变速变调：支持 0.5~100 倍变速；变调留空时采用自然变速（音调随速度变化），显式设置且与自然变调不一致时才补偿保持目标音调
- 输出参数支持自定义输出文件名（不含扩展名）；保存路径仍固定为任务 UUID 目录，暂不支持手动改路径
- 音频任务成功后会自动在顶部展示输出文件播放器（绿色紧凑样式），输入文件区域高度保持不变
- 响度标准化开启时，真峰值上限可留空自动沿用源文件真实峰值（超出 loudnorm 允许的 -9~0 dBTP 时按边界收敛）
- 音频信息接口：`GET /api/audio/info` 返回编码、采样率、时长、峰值/RMS/动态范围；`GET /api/files/content` 供播放器直接播放本机文件
- 本机文件浏览：`GET /api/files/browse` 直接浏览后端宿主机目录
- 任务目录：任务 ID 使用 UUIDv5（输入文件 + 音频功能）稳定生成，同一输入同一功能复用同一目录；重复生成前会清理旧产物，`tmp/<uuid>` 内保存输出/中间文件
- 任务持久化：SQLite（`backend/data/tasks.db`）保存任务 ID、类型、输入参数、输出参数、配置参数、目标路径、命令、日志与产物；服务重启后任务记录仍可查询
- Agent 对话记录：独立 `task_messages` 表保存消息、文件引用与工具调用记录，支持 `GET/POST /api/tasks/:id/messages`
- API：健康检查、设置读写/检测、参数 Schema、本机文件浏览、任务创建/列表/详情/取消/删除/SSE（单任务 + 全量）

单独启动后端（一般无需手动执行，一键启动已包含）：

```bash
cd backend
uv sync --locked
cd ..
backend/.venv/bin/python -m backend.run
```

Windows PowerShell：

```powershell
cd backend
uv sync --locked
cd ..
backend\.venv\Scripts\python -m backend.run
```

开发时前端 Vite 会把 `/api` 代理到 `http://127.0.0.1:5000`。

## 本机文件

WaveBank Otakus 定位是**本机处理工具**：WebUI 与 ffmpeg 运行在同一台机器上，
项目不包含文件上传链路。所有输入都来自用户本机：

- Agent 对话栏通过「添加本机文件」选择本机路径；
- 参数窗通过「浏览」选择本机文件；
- 后端直接读取该绝对路径，ffmpeg 处理原文件，不复制到上传目录。

## 内置 ffmpeg

项目使用**预编译 ffmpeg**，不要求安装 C 编译器或从源码编译。后端查找
ffmpeg 的顺序：自定义路径 → 系统 PATH（macOS 含 Homebrew 目录）→
内置预编译包（`backend/vendor/ffmpeg/<版本号或 latest>/`）。都没有时，会按
操作系统/架构自动下载预编译包：Linux 使用 BtbN/FFmpeg-Builds，
Windows 使用 GyanD/codexffmpeg（自动拉取最新 release）；
macOS 会在默认安装流程中自动安装 Homebrew/ffmpeg，或安装后由系统路径自动发现。
如果需要安装 Homebrew，启动脚本会先询问确认，sudo 密码输入由系统终端处理。

```bash
python -m backend.ffmpeg
```

Windows 见 [backend/vendor/ffmpeg/README.md](backend/vendor/ffmpeg/README.md)。

在「设置」页可以填写自定义 `ffmpeg` 可执行文件的绝对路径；留空则使用项目内置版本。
输入框占位提示会显示项目内置 ffmpeg 可执行文件的上一层目录。
