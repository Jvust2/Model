# Model

Drive-first local AI runtime: keep model files in Google Drive, while inference runs on the current Windows computer.

## Goal

The project reuses the proven Google Drive access ideas from `Jvust/drive-original-player`, but replaces media playback with an AI model library and a local inference bridge.

The primary target is:

```text
Google Drive model storage
        ↓
Drive model library (web UI)
        ↓
Google Drive streaming / mounted-drive path
        ↓
Local Runtime Bridge (127.0.0.1)
        ↓
llama.cpp / local CPU by default
```

The model remains owned by Google Drive. The local machine performs inference. A Drive client, operating system, browser, or runtime may still use temporary blocks/cache in RAM or on disk; this project does not promise zero local cache.

## v0.1 scope

- Scan a chosen Google Drive folder recursively without downloading model payloads.
- Index common model files: GGUF, safetensors, ONNX, PyTorch checkpoints and related files.
- GGUF is the first runnable format.
- Local Runtime Bridge starts `llama-server` on the current machine.
- CPU is the default. GPU offload is opt-in through environment configuration.
- A Service Worker exposes a range-only Drive reader for diagnostics and future virtual-file work.
- The static UI is intentionally separated from the local inference runtime.

## Reused from drive-original-player

The following ideas are ported from `Jvust/drive-original-player`:

- Google Drive OAuth session flow.
- Recursive Drive folder discovery.
- Shared client-side file-tree indexing.
- Google Drive Range request handling.
- The star-themed UI identity and icon.
- Resource-key handling for Drive files.

Media-specific code such as video seek, MSE rescue, image slideshow, rotation and video controls is not copied into this project.

## Current runnable path

For the first runnable version, expose the Google Drive model folder as a normal Windows path using Google Drive for desktop in streaming mode or another mounted-drive solution. Then point `MODEL_DRIVE_ROOT` to that folder.

Example:

```powershell
$env:MODEL_DRIVE_ROOT="G:\My Drive\Models"
$env:LLAMA_SERVER_PATH="D:\llama.cpp\llama-server.exe"
python runtime\local_bridge.py
```

Then serve the repository locally or through GitHub Pages and open the web UI.

The bridge listens on `127.0.0.1:8765` and starts llama.cpp on `127.0.0.1:8080` by default.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MODEL_DRIVE_ROOT` | required for launch | Mounted/streamed Google Drive model root |
| `LLAMA_SERVER_PATH` | `llama-server` | llama.cpp server executable |
| `MODEL_BRIDGE_PORT` | `8765` | Local bridge HTTP port |
| `MODEL_SERVER_PORT` | `8080` | llama-server port |
| `MODEL_THREADS` | CPU count - 2 | CPU inference threads |
| `MODEL_GPU_LAYERS` | `0` | GPU layers; 0 keeps CPU-only behavior |
| `MODEL_ALLOWED_ORIGINS` | localhost + Jvust2 GitHub Pages | Browser origins allowed to control the bridge |

## OAuth

The web client currently defaults to the OAuth bridge already used by `drive-original-player`:

```text
https://drive-oauth-bridge.143322378jb.workers.dev
```

It expects the bridge to return an `oauth_session` in the URL fragment and uses `drive.readonly`. If the existing Worker only redirects back to the old player deployment, its redirect handling must be extended for this repository before GitHub Pages sign-in is fully usable.

## Security

- The bridge binds only to `127.0.0.1`.
- The bridge checks browser Origin before accepting start/stop commands.
- Relative model paths are validated to prevent escaping `MODEL_DRIVE_ROOT`.
- Drive access tokens are not stored permanently by this repository's Service Worker.
- Never commit OAuth secrets, refresh tokens, private model URLs, or model weights to GitHub.

## Status

See `governance/PROJECT_STATE.md` and `governance/ARCHITECTURE.md`.

## Source project

- Source pattern: `Jvust/drive-original-player`
- Target project: `Jvust2/Model`
