# Project State

Updated: 2026-09-25

## Mission

Build a Drive-first AI model website where Google Drive is the model vault, the web UI discovers and classifies model packages, and inference runs through the correct local backend on the user's Windows computer.

## Current state

Status: **v0.6 multi-backend model-package routing in progress**

Verified on the live site:

- GitHub Pages deployment works.
- Google OAuth returns to the Model site.
- Google Drive API authorization works.
- `AI-Model-Vault` is auto-discovered.
- A real Drive scan completed across 203 folders and found 80 model-weight files.

Implemented:

- Google Drive OAuth/session flow.
- Google Drive API v3 metadata access.
- Recursive Drive discovery and Range diagnostics.
- Drive-root discovery with manual folder-ID fallback.
- `model_metadata.json` loading from the Drive vault.
- Model-weight files grouped into model packages instead of being treated as independent models.
- Registry-first category/modality/runtime classification.
- Backend routing for llama.cpp / ComfyUI / Diffusers / Transformers / PyTorch / ONNX Runtime / TFLite.
- Runtime backend detection endpoint: `GET /v1/backends`.
- Runtime execution-plan endpoint: `POST /v1/models/plan`.
- Path-private backend diagnostics.
- GGUF direct launch through llama.cpp remains functional.
- Same-page local chat for llama.cpp models.
- Windows one-click Runtime launcher.
- OAuth Bridge source is versioned in the repository.

## Architecture invariants

1. Google Drive remains canonical model storage.
2. `AI-Model-Vault/model_metadata.json` is the capability/runtime registry when available.
3. A model package is a directory/family of related files, not an individual weight shard.
4. GitHub stores code/governance only, never model weights or OAuth secrets.
5. Native inference remains local.
6. The web Drive root and `MODEL_DRIVE_ROOT` must identify the same model root.
7. Runtime binds to localhost.
8. Relative model paths are confined below `MODEL_DRIVE_ROOT`.
9. The website never receives local filesystem write access.
10. Backend detection must not expose full local filesystem paths.
11. A format extension alone is not enough to claim a model is automatically runnable.
12. GGUF + llama.cpp is the first fully automatic adapter.
13. Other backends become automatic only after a model-family-specific workflow/adapter exists.

## Current user flow

    Open Model website
       ↓
    Connect Google Drive
       ↓
    Auto-find AI-Model-Vault
       ↓
    Scan Drive
       ↓
    Load model_metadata.json
       ↓
    Group weight shards into model packages
       ↓
    Route package to backend/workspace
       ↓
    Runtime checks local backend and package visibility
       ↓
    Direct launch when an adapter exists

## Current backend state

| Backend | Detection | Automatic launch |
| --- | --- | --- |
| llama.cpp | yes | yes |
| ComfyUI | yes | not yet |
| Diffusers | yes | not yet |
| Transformers | yes | not yet |
| PyTorch | yes | not yet |
| ONNX Runtime | yes | not yet |
| TFLite | yes | not yet |

"Detection" means the Runtime can identify whether the local environment is available. It does not mean arbitrary weight files can already be launched safely.

## Next technical steps

1. Finish CI validation for model-package grouping and backend planning.
2. Add ComfyUI workflow adapters for Wan2.2 / Qwen-Image / FLUX families.
3. Add Diffusers pipeline adapters where model families are supported cleanly.
4. Add Transformers adapters for GOT-OCR and Qwen embedding/reranker families.
5. Add PyTorch adapters for Chronos / TimesFM.
6. Add workspace-specific web UIs: image, image-edit, video, vision/OCR, embedding and time-series.
7. Add token/output streaming and benchmark capture.
8. Evaluate sparse-cache / virtual filesystem direct Drive-file-ID access after mounted-drive adapters are stable.
