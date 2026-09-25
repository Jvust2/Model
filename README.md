# Model

Drive-first local AI website: Google Drive is the model vault, the website discovers and classifies model packages, and the correct local runtime performs inference.

## Current flow

    Open Model website
          ↓
    Connect Google Drive
          ↓
    Auto-find AI-Model-Vault
          ↓
    Scan Drive metadata
          ↓
    Load model_metadata.json
          ↓
    Group weight shards into model packages
          ↓
    Choose backend + workspace
          ↓
    Local Runtime checks environment
          ↓
    Launch through a supported adapter

The live OAuth + Drive scan path is already working.

## Model packages instead of raw weight files

Files such as:

- `.safetensors`
- `.pth`
- `.pt`
- `.ckpt`
- `.gguf`
- `.onnx`

are indexed, but multiple files inside one model directory are grouped into one model package.

For example, the Wan2.2-Animate-14B shard files are one model package, not several separate models.

## Drive metadata registry

The website reads:

    AI-Model-Vault/model_metadata.json

and uses its category, modality, recommended runtime and device-fit metadata before falling back to path/extension heuristics.

## Backend routing

Current backend targets:

- GGUF → llama.cpp
- image/video packages → ComfyUI / Diffusers
- OCR/multimodal/RAG → Transformers
- time-series → PyTorch
- ONNX → ONNX Runtime
- TFLite → TFLite

The website no longer labels every non-GGUF model as "暂不支持运行".

Instead, each package exposes a **运行方案** and a backend-specific preparation action.

## What can automatically launch today?

### Direct

- GGUF through llama.cpp.

### Detected/planned but model-family adapter still required

- ComfyUI
- Diffusers
- Transformers
- PyTorch
- ONNX Runtime
- TFLite

This distinction is intentional: arbitrary safetensors/PTH/CKPT files are not self-describing executable applications.

See `docs/MULTI_BACKEND.md`.

## Local Runtime

Run:

    runtime\Model.cmd

The Runtime remains bound to localhost.

Additional endpoints:

    GET  /v1/backends
    POST /v1/models/plan

These report backend readiness and per-model execution requirements without exposing full local filesystem paths.

## Google Drive + local mount

Google Drive API is used for cloud discovery and metadata.

Google Drive for desktop supplies native, seekable local paths to runtimes that need them.

The website-selected Drive root and `MODEL_DRIVE_ROOT` must refer to the same `AI-Model-Vault` folder.

## Website

Expected production URL:

    https://jvust2.github.io/Model/

## Next adapters

1. ComfyUI workflows for Wan2.2 / Qwen-Image / FLUX.
2. Diffusers model-family pipelines.
3. Transformers adapters for GOT-OCR and Qwen embedding/reranker.
4. PyTorch adapters for Chronos / TimesFM.
5. Workspace UIs for image, video, edit, vision/OCR, embedding and time-series.

Source pattern: `Jvust/drive-original-player`
Target: `Jvust2/Model`
