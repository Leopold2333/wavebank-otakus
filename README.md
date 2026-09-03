<div align="center">

# WaveBank Otakus · 音波库

**本地部署的 Agent 驱动音频处理工作台**

[![Python](https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.1-000000?logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.2-1C3C3C?logo=langgraph&logoColor=white)](https://langchain-ai.github.io/langgraph/)
[![uv](https://img.shields.io/badge/uv-locked-DE5FE9?logo=uv&logoColor=white)](https://docs.astral.sh/uv/)
[![pymss](https://img.shields.io/badge/pymss-2.1.3-FF6F00)](https://pypi.org/project/pymss-core/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-bundled-007808?logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)

[![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.2-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Ant Design](https://img.shields.io/badge/Ant%20Design-6.6-0170FE?logo=antdesign&logoColor=white)](https://ant.design/)
[![Zustand](https://img.shields.io/badge/Zustand-5.0-433E38)](https://zustand.docs.pmnd.rs/)
[![License](https://img.shields.io/badge/License-Apache%202.0-D22128)](LICENSE)

</div>

---

## 项目简介

WaveBank Otakus 是一个跑在本机的音频媒体处理平台，把两种交互方式合在同一个界面里：

- **Agent 工作台**：用一句自然语言描述需求，智能体自行探测文件、确定参数、发起任务，并在完成后汇报结果；
- **人工参数窗**：智能体能调的每一项参数都有对应的可视化表单，随时可以接管、微调、重跑。

适用于手上有大量音频与视频素材、希望批量处理，但不愿意背 ffmpeg 参数、也不想折腾 Python 推理环境的场景。

全程本机、零上传。界面、处理引擎与模型推理运行在同一台机器上，项目中没有文件上传链路——选中的是本机路径，处理的就是原文件。

## 功能

| 能力 | 说明 |
| --- | --- |
| 格式转换 | 任意音视频 → mp3 / aac / m4a / flac / ogg / wav，可控码率、采样率、声道 |
| 视频提取音频 | 从视频中剥离音轨，可直接指定目标编码 |
| 音频裁切 | 按起始时间与时长精确切片 |
| 变速变调 | 0.5×～100× 变速；变调可随速度自然变化，也可补偿保持原调 |
| 背景去噪 | 频域降噪，强度可调 |
| 人声分离 | 接入 MSST 模型族，人声、伴奏、鼓贝斯、男女声等按需输出 |
| 多步编排 | 智能体自动把多个操作串成流水线，前一步的产物自动作为下一步输入 |

## 快速开始

### 一键启动

```bash
git clone <repo-url> wavebank-otakus
cd wavebank-otakus
python start.py
```

Windows 可直接双击 `start.bat`，Linux / macOS 可执行 `./start.sh`。

启动器会自动完成后端依赖同步、ffmpeg 运行时检查与前端依赖安装，随后同时拉起前后端；两端就绪后自动打开浏览器，`Ctrl+C` 一次性退出。

```bash
python start.py --no-browser    # 启动后不自动打开浏览器
python start.py --no-install    # 跳过依赖安装与 ffmpeg 自动安装
```

默认地址：前端 `http://localhost:5173`，后端 `http://127.0.0.1:5000`。

### 开发模式

```bash
# 后端
cd backend && uv sync --locked && cd ..
backend/.venv/bin/python -m backend.run          # Windows: backend\.venv\Scripts\python -m backend.run

# 前端
cd frontend && npm install && npm run dev
```

开发服务器监听 `0.0.0.0:5173` 并把 `/api` 代理到后端，在 WSL 中启动、由 Windows 浏览器访问同样可用。

## 环境自动配置

除 Python、`uv` 与 Node.js 外，其余运行时均由项目自行准备。

### 内置 ffmpeg

无需安装编译器，也无需从源码编译。后端依次查找设置页中的自定义路径、系统 PATH、项目内置目录；三处均未命中时，按操作系统与架构自动下载对应的预编译包：Linux 与 Windows ARM 使用 BtbN 构建，Windows x64 使用 GyanD 构建并自动拉取最新版本，macOS 走 Homebrew 安装流程（需要授权时会在终端提示）。

下载完成后会实地验证编码器可用性，确认界面上所有输出格式（MP3 / AAC / FLAC / OGG / WAV）都能正常编码，才将这份 ffmpeg 记为可用。之后可在设置页随时切换为自定义路径。

### 推理运行时 pymss

人声分离以 [`pymss`](https://pypi.org/project/pymss-core/) 作为 MSST 模型运行时，内部会引入 PyTorch。它以本地源方式引用，因此需要与本项目放在同一级目录：

```
workspace/
├── wavebank-otakus/     ← 本项目
└── pymss/               ← pymss 源码目录
```

依赖同步统一交给 `uv sync --locked`，严格按锁文件安装，不会隐式升级，也不会污染系统 Python，虚拟环境固定落在项目内。

Web 服务本身从不加载 PyTorch。模型清单解析、模型下载与推理执行都在独立的短生命周期子进程中完成，因此主服务启动迅速、内存占用稳定，推理进程即使异常退出也不会影响界面。

### 前端依赖

首次启动时若缺少 `node_modules` 会自动安装，随后拉起开发服务器，无需额外操作。

## Agent 工作台

界面分为上下两块：上方是人工参数窗，随当前功能自动渲染表单；下方是 Agent 对话栏。两者共享同一份文件引用，在对话中添加的本机文件会同步出现在参数窗的输入框中。

对话发出后，智能体的思考过程、调用的能力、执行日志与最终答复都会实时流式呈现。它清楚你当前所在的功能页、已关联的文件以及参数窗中的现有取值，因此「把这个转成 320k 的 mp3」这类省略主语的说法也能直接理解。

### 单操作任务

需求只涉及一步时，智能体直接发起对应任务：格式转换、提取音频、裁切、变速变调、去噪或人声分离。它可用的参数与参数窗完全一致——两侧共用同一份参数定义，不存在「智能体能做、表单做不了」的割裂。

任务发起后，智能体会等待整条流程真正结束，再依据实际的执行状态、输出文件与错误信息汇报，而非发出即宣告完成。

### 多操作流水线

需求包含多个步骤时，智能体会将其规划为一条流水线一次性提交，无需手动执行多轮、再手动传递中间文件。

例如：

> 把这个视频里的人声抠出来，再按男女声分开，最后导出 320k 的 mp3

将被自动规划为：提取音频 → 人声/伴奏分离（只保留人声）→ 男女声分离 → 按 320k mp3 输出。

自动规划主要体现在以下几点：

- **中间文件自动衔接**：上一步的产物直接作为下一步的输入，全程无需人工指定中间路径；
- **中间环节保持无损**：过程文件一律使用无损格式，避免多次有损转码累积损伤，仅最后一步应用目标输出格式；
- **输出设置只作用于终点**：输出格式、文件名、码率、采样率、声道、音量与响度等参数自动落到最后一步，中间产物使用可读的临时命名，来源环节一目了然；
- **进度连续呈现**：任务中心显示的是整条流水线的总进度，不会每一步归零重来；
- **必要的约束校验**：人声分离可能同时产出多条音轨，处于中间环节时会要求明确只保留一条，否则下一步的输入无法确定；单条流水线最多 8 步。

整条流水线共用一个任务，每一步的日志与产物记录在同一条记录中，可逐步回看。

## 人声分离

人声分离是唯一涉及深度模型的功能，整条链路按「零手动准备」设计。

### 模型按需下载

无需预先下载任何权重，直接提出需求即可。发起任务时若本地缺少对应模型，系统会先自动下载再开始推理，下载过程占据任务进度的前半段，可实时看到「已完成 812 / 2043 MB」这类文案。

下载源依次尝试 ModelScope、HuggingFace 及其镜像，主源额外做文件校验；中断留下的残片会被自动清理，不会影响下一次下载。若此时恰好有一个手动预下载正在处理同一模型，任务会等待其完成，避免重复下载。

模型缓存目录可通过环境变量指定，默认位于项目数据目录下。

### 模型自动选型

模型清单并非写死，而是运行时从 pymss 实时读取，并按「超大类 → 大类 → 任务小类」整理为中文分类。智能体沿这三级定位到需求对应的任务小类，使用该小类的推荐默认模型，除非你明确指定某个具体模型。

这也让它能给出最佳实践式的规划。以分离男女声为例，它不会直接拿原曲推理，而是先做人声/伴奏分离取得干净人声，再对人声做男女声分离，自动串成两步流水线。

### 推理执行

模型就绪后依次进入加载、读取音频、分离推理、写出结果几个阶段，推理进度按已处理时长实时换算，全程可取消。

- **设备**：自动 / CPU / CUDA / MPS / MLX，系统会探测本机实际可用性并回填显卡名称，不可用的选项在界面上置灰；
- **输出音轨**：留空则输出模型支持的全部音轨，也可只保留其中若干条；
- **输出格式**：wav / flac / mp3；
- **高级参数**：TTA、批大小、重叠、分块、标准化等均为可选，留空即沿用模型自带的推荐值；参数窗会展示这些推荐值，并按模型架构自动屏蔽不支持的项。

设置页的模型库另外提供手动预下载、下载进度查看、取消下载与本地权重删除。

## 任务中心

所有任务，无论来自 Agent 还是参数窗，都汇入同一个任务中心：

- **实时刷新**：进度、当前阶段、执行日志、实际命令与产物列表全部流式更新；
- **可取消**：取消会真正终止底层处理进程，而非仅标记状态；
- **持久化**：任务记录落库保存，服务重启后依然可查，可复看每一步的参数与产物；
- **稳定复用**：同一输入文件的同一种处理复用同一份任务目录，重跑前自动清理旧产物；
- **对话留痕**：智能体的每一轮对话与工具调用都保存在对应任务下，可回滚到任意一轮重新开始。

## 配置

项目默认值随仓库提供，用户改动单独保存，两者相互隔离，升级不会覆盖本地设置。设置页可配置 ffmpeg 路径、Agent 模型与接入点以及模型库。

密钥仅走环境变量与加密存储：LLM API Key 加密后落盘，接口返回一律脱敏，不会出现在日志、任务记录或前端明文中。

常用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WAVEBANK_HOST` | `127.0.0.1` | 后端监听地址 |
| `WAVEBANK_PORT` | `5000` | 后端端口 |
| `WAVEBANK_FRONTEND_PORT` | `5173` | 前端端口 |
| `WAVEBANK_MSST_MODEL_DIR` | 项目数据目录 | 人声分离模型缓存位置 |
| `WAVEBANK_SKIP_FFMPEG_AUTO_INSTALL` | — | 置 `1` 时跳过 ffmpeg 自动安装 |

## 许可证

[Apache License 2.0](LICENSE)
