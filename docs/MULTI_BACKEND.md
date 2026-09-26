# Multi-backend model packages

## Why this exists

A single AI model is often a directory containing many weight shards and helper files.

For example:

    video_ultra/Wan2.2-Animate-14B/
      diffusion_pytorch_model-00001-of-00004.safetensors
      diffusion_pytorch_model-00002-of-00004.safetensors
      diffusion_pytorch_model-00003-of-00004.safetensors
      diffusion_pytorch_model-00004-of-00004.safetensors
      models_t5_umt5-xxl-enc-bf16.pth
      ...

Those files are not independent runnable models. The web UI therefore groups them into one model package.

## Metadata source

The website reads:

    AI-Model-Vault/model_metadata.json

This registry supplies:

- model id and display name
- category and modality
- capabilities
- artifact type
- quality tier
- recommended runtime
- per-device fit information

The Drive registry remains the source for model capability metadata. The website falls back to path/extension heuristics only when no registry entry matches.

## Backend routing

Current routing:

| Model/package | Backend target | Workspace |
| --- | --- | --- |
| GGUF LLM/reasoning/code/novel | llama.cpp | chat |
| Image/image-edit/video packages | ComfyUI or Diffusers | image/video |
| OCR/multimodal/RAG | Transformers | vision/embedding |
| Time-series PyTorch packages | PyTorch | timeseries |
| ONNX artifacts | ONNX Runtime | task-specific |
| TFLite artifacts | TFLite | task-specific |

The backend target is selected from model_metadata.json first.

## What is runnable now

### Direct automatic launch

- GGUF through Google Drive API → resumable local cache → llama.cpp.
- Wan2.2 TI2V 5B through managed ComfyUI.
- HunyuanVideo 1.5 text-to-video through managed ComfyUI.

### Backend identified, adapter still required

- Other ComfyUI families
- Diffusers
- Transformers
- PyTorch
- ONNX Runtime
- TFLite

The Runtime can detect whether these environments are installed and can return a model execution plan. It does not yet pretend that arbitrary .safetensors/.pth/.ckpt files can be launched generically, because those formats do not encode enough information to infer every architecture, pipeline, workflow, preprocessor, or adapter automatically.

## Model availability states

Runtime now exposes `GET /v1/models/capabilities` and includes the same state in `POST /v1/models/plan`:

- **可直接使用**: this repository has a tested launcher for the exact model family.
- **需要适配器**: the Drive artifact is present, but the task-specific input/output adapter is not connected yet.
- **需要工作流**: the weights are present, but the ComfyUI/Diffusers workflow is not connected yet.
- **Drive 文件不完整**: the integrity report says required weights or dependencies are missing in Drive.
- **依赖不完整**: this model depends on another incomplete model.

The website displays these states on every model card and in the runtime plan. A registered model is therefore never presented as runnable solely because its file extension is recognized.

## Runtime endpoints

    GET  /v1/backends
    POST /v1/drive/session
    POST /v1/models/cache
    POST /v1/models/plan

/v1/backends reports local backend availability without exposing local filesystem paths.

/v1/models/plan returns:

- target backend
- workspace
- backend detection status
- Drive API session / cache mode
- required dependencies
- whether automatic launch is currently implemented

## Next adapters

Priority order:

1. ComfyUI workflow adapter for Wan2.2 / Qwen-Image / FLUX families.
2. Diffusers adapter for supported image/video repositories.
3. Transformers adapter for GOT-OCR and Qwen embedding/reranker models.
4. PyTorch adapter for Chronos / TimesFM.
5. ONNX task adapter framework.

Each adapter should be model-family aware rather than extension-only.


## Managed ComfyUI video path

The video web workspace uses a pinned official ComfyUI Windows Portable NVIDIA release and official Comfy-Org workflow templates. The v0.9 automatic video path currently requires an NVIDIA Windows environment.

The Drive model package remains the user's model catalog/source identity. For execution, Runtime downloads the ComfyUI-compatible model artifacts declared by the official workflow into a local derived cache. This is intentionally separate from the Drive-native package because the file layout/format expected by ComfyUI can differ.

Current adapters:

- `wan2.2-ti2v-5b`
- `hunyuanvideo-1.5`

The Hunyuan adapter targets the base 720p output node and prunes the optional super-resolution branch to avoid unnecessary SR model downloads.
