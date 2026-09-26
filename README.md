# Model

Drive-first local AI website.

Google Drive is the canonical model vault. The website discovers model packages with Google Drive API, while the local Windows Runtime downloads selected models directly from Drive API into a local cache and runs them on the current computer.

**Google Drive for desktop is not required.**

## Current flow

    Open Model website
          ↓
    Connect Google Drive
          ↓
    Auto-find AI-Model-Vault
          ↓
    Scan model metadata
          ↓
    Select a GGUF
          ↓
    Browser sends temporary Drive session to localhost Runtime
          ↓
    Runtime downloads/resumes the GGUF into local cache
          ↓
    llama.cpp launches from cache
          ↓
    Chat in the same website

## One-time Windows install

For normal use, open the [Runtime package workflow](https://github.com/Jvust2/Model/actions/workflows/runtime-package-drive-api.yml), choose the latest successful run on `main`, download its `Model-Web-Runtime-…` artifact, extract it, then run:

    runtime\Install.cmd

The source repository does not contain `ModelRuntime.exe`; use the workflow artifact above, which includes the compiled executable. The packaged installer does **not** require a system Python installation.

The installer:

- uses the bundled standalone `ModelRuntime.exe`;
- asks for `llama-server.exe` only when it cannot find one automatically;
- copies the Runtime to `%LOCALAPPDATA%\JvustModel\app`;
- enables current-user Windows auto-start;
- starts a tray Runtime in the background;
- opens the Model website.

After that, normal use is simply:

    open https://jvust2.github.io/Model/

The website automatically reconnects to the local Runtime. You do not need to run `Model.cmd` every time.

To remove the background Runtime:

    runtime\Uninstall.cmd

Use `runtime\Model.cmd` only as a manual/debug launcher.

Default model cache:

    D:\Model

You can override it with `MODEL_CACHE_ROOT` or `runtime\start_bridge.ps1 -CacheRoot "E:\ModelCache"`.

Runtime config:

    %LOCALAPPDATA%\JvustModel\runtime.json

Runtime logs:

    %LOCALAPPDATA%\JvustModel\logs

## Drive session security

The browser sends the current short-lived Google Drive access token to:

    http://127.0.0.1:8765/v1/drive/session

The Runtime keeps it in memory only. It is not persisted in config or cache metadata.

## Download/cache behavior

GGUF models are downloaded directly through Google Drive API.

- existing complete cache → reuse immediately;
- interrupted download → resume from `.part` when Drive honors Range;
- completed file → validate GGUF header, then launch llama.cpp.

Large models still need enough local disk space for the cache. The desktop Drive app is not needed.

## 当前实际可用状态

模型登记、Drive 文件和运行适配器是三个不同状态。网页会展示登记表中的全部模型，但只有同时满足“Drive 主库有权重”和“对应运行适配器已接通”的模型才会出现启动入口。

目前已经接通网页自动运行的模型是 Wan2.2 TI2V 5B 和 HunyuanVideo 1.5 视频工作流，以及 Drive 中实际存在 GGUF 文件时的 llama.cpp 聊天链路。图像、OCR、Embedding、Reranker 和时间序列模型会显示后端检测与运行方案，直到对应的模型家族工作流或专用适配器接通。

模型卡片上的“查看运行方案”只会读取本机后端和模型状态，不会把任意 .safetensors、.pth 或 .ckpt 文件假设成可以直接启动的模型。这样可以避免下载大量文件后才发现缺少 VAE、文本编码器、预处理器或工作流。

## Backend routing

Current targets:

- GGUF → llama.cpp
- image/video → ComfyUI / Diffusers
- OCR/multimodal/RAG → Transformers
- time-series → PyTorch
- ONNX → ONNX Runtime
- TFLite → TFLite

Automatic web adapters now include:

- GGUF → Drive API cache → llama.cpp → web chat.
- Wan2.2 TI2V 5B → managed ComfyUI → web video workspace.
- HunyuanVideo 1.5 T2V → managed ComfyUI → web video workspace.

For the video adapters, the Drive package remains the catalog/model identity, while Runtime caches the official ComfyUI-compatible backend artifacts required by the selected workflow. This is necessary because the Drive-native training/inference package layout is not identical to ComfyUI's repackaged model layout.

The v0.9 automatic video path currently targets NVIDIA Windows systems.

First video use may download:

- ComfyUI Windows Portable (NVIDIA cu126);
- several large model artifacts required by the official workflow.

Those files are cached under `D:\Model\video` by default and reused later. Set `MODEL_VIDEO_ROOT` to override the video cache only.

See `docs/MULTI_BACKEND.md` for the remaining family adapters.

## Video workspace

Select an adapted video model in the model library and click **使用视频模型**.

The web workspace exposes prompt, negative prompt, resolution, frames, FPS, steps, CFG and seed. Runtime then prepares ComfyUI, queues the official workflow, tracks progress and returns the generated video directly to the browser.

Current direct video adapters:

- Wan2.2-TI2V-5B
- HunyuanVideo-1.5

Video generation is hardware-intensive; successful execution depends on available GPU/VRAM/RAM/disk and the selected settings.

## Website

Production:

    https://jvust2.github.io/Model/

## Source of truth

- GitHub: code, governance, current project state.
- Google Drive: model artifacts and model metadata registry.

## AI 工作区

网站现在提供统一的多工作区入口：

- 本机聊天：GGUF / llama.cpp
- 本机视频：Wan2.2、HunyuanVideo
- 图像生成：ComfyUI / Diffusers 运行方案
- 图像编辑：局部重绘、扩图、放大
- 视觉 / OCR：Transformers 运行方案
- 向量检索：Embedding / Rerank 知识库入口
- 时序预测：PyTorch 预测入口

图像、视觉、检索和时序工作区会先检查本机后端，并保留模型家族适配边界；模型库卡片仍是模型包与 Drive 元数据的唯一来源。
