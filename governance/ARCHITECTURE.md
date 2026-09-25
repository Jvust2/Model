# Architecture

## Data path

```text
Browser / GitHub Pages
  │
  ├─ OAuth Bridge
  │     ↓
  │  Google Drive API
  │     ├─ root-folder discovery
  │     ├─ recursive file metadata scan
  │     ├─ model_metadata.json
  │     └─ Range diagnostics
  │
  ├─ Model package index
  │     ├─ group weight shards by model directory/family
  │     ├─ match Drive registry metadata
  │     └─ select backend + workspace
  │
  └─ localhost Runtime Bridge (127.0.0.1)
          ├─ backend detection
          ├─ execution planning
          ├─ GGUF inspect/start/stop
          └─ chat
              ↓
        backend adapter
          ├─ llama.cpp
          ├─ ComfyUI
          ├─ Diffusers
          ├─ Transformers
          ├─ PyTorch
          ├─ ONNX Runtime
          └─ TFLite
              ↓
     Google Drive desktop mount
              ↓
          Google Drive
```

## Model package model

A model is represented as a package, not a single weight file.

Example:

```text
video_ultra/Wan2.2-Animate-14B/
  diffusion_pytorch_model-00001-of-00004.safetensors
  diffusion_pytorch_model-00002-of-00004.safetensors
  diffusion_pytorch_model-00003-of-00004.safetensors
  diffusion_pytorch_model-00004-of-00004.safetensors
  models_t5_umt5-xxl-enc-bf16.pth
```

The browser groups those files into one package and matches the package against `model_metadata.json`.

## Drive registry

The website attempts to load:

```text
AI-Model-Vault/model_metadata.json
```

Registry fields used by the UI include:

- id / name / repo
- category / modality
- capabilities
- artifact type
- quality tier
- device fit
- recommended runtime

If no registry entry matches, path and extension heuristics provide a fallback classification.

## Backend routing

Backend selection is registry-first.

Typical routing:

- GGUF / llama.cpp recommendations → llama.cpp
- image/video packages → ComfyUI or Diffusers
- OCR/multimodal/RAG → Transformers
- time-series packages → PyTorch
- ONNX → ONNX Runtime
- TFLite → TFLite

The UI exposes a "运行方案" action for every model package. Non-GGUF packages are no longer shown as generically unsupported.

## Runtime Bridge

Current endpoints:

- `GET /health`
- `GET /v1/runtime`
- `GET /v1/backends`
- `POST /v1/models/plan`
- `POST /v1/models/inspect`
- `POST /v1/models/start`
- `POST /v1/models/stop`
- `POST /v1/chat/completions`

`/v1/backends` detects local runtime dependencies without exposing full local paths.

`/v1/models/plan` reports:

- selected backend
- workspace
- backend detection status
- package visibility in the mounted Drive root
- required dependencies
- whether automatic launch is implemented

## Why arbitrary safetensors/PTH/CKPT cannot be launched generically

Weight containers do not uniquely define every required model architecture, tokenizer, VAE, scheduler, processor, workflow, node graph or preprocessing pipeline.

Therefore Model must use model-family-specific adapters instead of treating an extension as a universal executable format.

## Cloud-to-local path invariant

The website Drive root and `MODEL_DRIVE_ROOT` must refer to the same folder.

Cloud path:

```text
AI-Model-Vault/video_ultra/Wan2.2-Animate-14B/...
```

Local mount:

```text
G:\My Drive\AI-Model-Vault\video_ultra\Wan2.2-Animate-14B\...
```

Only the relative path is sent to Runtime.

## Security invariants

1. GitHub never stores model weights or OAuth secrets.
2. Drive API access remains read-oriented for the website.
3. Runtime binds to localhost.
4. Browser origins are checked before local control/chat calls.
5. Relative paths are confined below `MODEL_DRIVE_ROOT`.
6. Full local filesystem paths are not returned to the public site.
7. Backend diagnostics expose detection state, not private paths.
