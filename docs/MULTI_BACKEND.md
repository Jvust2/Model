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

### Backend identified, adapter still required

- ComfyUI
- Diffusers
- Transformers
- PyTorch
- ONNX Runtime
- TFLite

The Runtime can detect whether these environments are installed and can return a model execution plan. It does not yet pretend that arbitrary .safetensors/.pth/.ckpt files can be launched generically, because those formats do not encode enough information to infer every architecture, pipeline, workflow, preprocessor, or adapter automatically.

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
