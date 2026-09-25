# Project State

Updated: 2026-09-25

## Mission

Build a Drive-first AI model website where Google Drive remains the model vault, the website discovers/classifies model packages, and local inference runs without requiring Google Drive for desktop.

## Current state

Status: **v0.9 web video runtime in validation**

Verified on the live site before this branch:

- GitHub Pages deployment works.
- Google OAuth returns to the Model site.
- Google Drive API authorization works.
- `AI-Model-Vault` is auto-discovered.
- A real Drive scan completed across 203 folders and found 80 model-weight files.

Implemented on this branch:

- Added one-time `runtime/Install.cmd` for normal Windows use.
- Packaged Windows builds include standalone `ModelRuntime.exe`; user Python is not required.
- Runtime installs under `%LOCALAPPDATA%\JvustModel\app`.
- Current-user Windows auto-start is registered under HKCU.
- A tray Runtime keeps the localhost engine alive and restarts it after failures.
- The website automatically reconnects to localhost Runtime; manual checking is no longer the normal flow.
- The main UI hides the technical Runtime URL/logs under advanced diagnostics.
- Added `runtime/Uninstall.cmd`.
- Removed the Google Drive desktop mount requirement from the Windows launcher.
- First-run setup now asks only for `llama-server.exe`.
- Runtime cache defaults to `%LOCALAPPDATA%\JvustModel\cache`.
- Browser syncs the short-lived Google Drive access token to localhost Runtime memory only.
- Runtime accepts Drive file metadata by file ID.
- GGUF files can be downloaded directly from Google Drive API to local cache.
- Partial `.part` downloads can resume with HTTP Range.
- Cached models are reused on later launches.
- OAuth access tokens are not written to cache metadata or config.
- GGUF launch automatically continues after the Drive download completes.
- Runtime status exposes download bytes/progress.
- Existing multi-backend model-package routing remains in place.
- Managed ComfyUI video Runtime added.
- Official ComfyUI templates vendored for Wan2.2 TI2V 5B and HunyuanVideo 1.5 720p T2V.
- Web video workspace added with prompt/settings/progress/video playback.
- Runtime exposes /v1/video/generate, /v1/video/status, /v1/video/stop and ranged video output.
- First video run can install pinned ComfyUI Windows Portable automatically.
- Video workflow dependencies are downloaded lazily and cached locally.
- Workflow graph is pruned to the selected output, so Hunyuan's optional 1080p SR branch is not downloaded for the base 720p output.
- Other ComfyUI/Diffusers model families remain future adapters.

## Architecture invariants

1. Google Drive remains canonical model storage.
2. Google Drive for desktop is not required.
3. GitHub stores code/governance only, never model weights or OAuth secrets.
4. OAuth access tokens passed to localhost Runtime are memory-only.
5. Runtime binds to localhost and enforces allowed browser origins.
6. Model cache is local implementation detail and may be deleted/rebuilt.
7. A Drive file ID is never used directly as a filesystem path.
8. GGUF direct launch requires a complete verified local cache file.
9. A model format extension alone does not imply that arbitrary non-GGUF files are executable.
10. Model-family-specific adapters are required for ComfyUI / Diffusers / Transformers / PyTorch families.

## Normal user flow

    One-time: Install.cmd
       ↓
    Windows login auto-starts tray Runtime
       ↓
    Open Model website
       ↓
    Connect Google Drive
       ↓
    Scan AI-Model-Vault
       ↓
    Select GGUF model
       ↓
    Browser sends temporary Drive token + file ID to localhost
       ↓
    Runtime downloads/resumes file into local cache
       ↓
    Validate GGUF header
       ↓
    Launch llama-server from cache
       ↓
    Chat in the website

## Current backend state

| Backend | Detection | Automatic launch |
| --- | --- | --- |
| llama.cpp | yes | yes, via Drive API cache |
| ComfyUI | yes | Wan2.2 TI2V 5B + HunyuanVideo 1.5 T2V |
| Diffusers | yes | not yet |
| Transformers | yes | not yet |
| PyTorch | yes | not yet |
| ONNX Runtime | yes | not yet |
| TFLite | yes | not yet |

## Next technical steps

1. Validate a real Drive GGUF download + cache + llama.cpp round trip on Windows.
2. Add cache management UI: size, clear selected model, clear all.
3. Add cancellation for active Drive downloads.
4. Validate full real-video generation on the user's Windows hardware.
5. Extend ComfyUI adapters to Wan2.2 T2V/I2V/Animate, Qwen-Image and FLUX.
6. Add Transformers/PyTorch package adapters.
6. Add workspace-specific image/video/OCR/embedding/time-series UIs.
7. Evaluate sparse-cache / virtual filesystem access only after the full-file cache path is stable.
