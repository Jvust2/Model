# Model

Drive-first local AI runtime: keep model files in Google Drive while inference runs on the current Windows computer.

## Goal

Model reuses the proven Google Drive access ideas from Jvust/drive-original-player, but replaces media playback with an AI model library and a local inference bridge.

Architecture:

    Google Drive model storage
            ↓
    Drive model library (web UI)
            ↓
    Google Drive streaming / mounted-drive path
            ↓
    Local Runtime Bridge (127.0.0.1)
            ↓
    llama.cpp / local CPU by default

Google Drive remains the canonical source for model files. The local machine performs inference. Drive, the OS, the browser, or the runtime may still use temporary blocks/cache in RAM or on disk; the project does not promise zero local cache.

## v0.2 scope

- Recursively scan a chosen Google Drive folder without downloading model payloads for indexing.
- Index common model files such as GGUF, safetensors, ONNX and PyTorch checkpoints.
- Run GGUF first through llama-server.
- Keep CPU as the default; GPU offload is opt-in.
- Validate the local GGUF fixed header before launch without reading tensor payloads.
- Track runtime phases: idle, loading, ready, failed.
- Poll llama.cpp /health before reporting that a model is ready.
- Keep a range-only Service Worker for Drive random-access experiments and future virtual-file work.
- Report local runtime diagnostics without exposing the full absolute model path.

## Reused from drive-original-player

Reused concepts:

- Google Drive OAuth session flow.
- Recursive Drive folder discovery.
- Client-side model-tree indexing.
- Google Drive Range request handling.
- Resource-key support.
- Star-themed visual identity.

Intentionally excluded:

- HTML video playback.
- MSE rescue logic.
- Gallery/slideshow code.
- Video download and quality controls.

## Windows runnable path

For the baseline runtime, expose the Google Drive model folder as a normal Windows path using Google Drive for desktop streaming mode or another mounted-drive solution, then point MODEL_DRIVE_ROOT at that path.

Example PowerShell:

    .\runtime\start_bridge.ps1 -DriveRoot "G:\My Drive\Models" -LlamaServerPath "D:\llama.cpp\llama-server.exe"

The bridge listens on 127.0.0.1:8765 and launches llama-server on 127.0.0.1:8080 by default.

### Runtime configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| MODEL_DRIVE_ROOT | required for launch | Mounted/streamed Google Drive model root |
| LLAMA_SERVER_PATH | llama-server | llama.cpp server executable |
| MODEL_BRIDGE_PORT | 8765 | Local bridge HTTP port |
| MODEL_SERVER_PORT | 8080 | llama-server port |
| MODEL_THREADS | CPU count - 2 | CPU inference threads |
| MODEL_GPU_LAYERS | 0 | GPU layers; 0 keeps CPU-only behavior |
| MODEL_LOAD_MODE | none | llama.cpp load mode: auto, none, mmap, mlock, mmap+mlock, or dio |
| MODEL_READY_WARN_SECONDS | 300 | Warn if loading has not reached /health = 200; monitoring continues |
| MODEL_HEALTH_INTERVAL | 0.5 | Readiness polling interval in seconds |
| MODEL_ALLOWED_ORIGINS | localhost + Jvust2 GitHub Pages | Browser origins allowed to control the bridge |

MODEL_LOAD_MODE=none is the compatibility-oriented baseline for Drive-mounted model files. Other modes should be benchmarked per machine and Drive setup.

## Local bridge API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /health | Bridge health |
| GET | /v1/runtime | Runtime phase, readiness, diagnostics and recent logs |
| POST | /v1/models/inspect | Validate a local GGUF fixed header below MODEL_DRIVE_ROOT |
| POST | /v1/models/start | Validate and start a GGUF model; returns HTTP 202 while loading |
| POST | /v1/models/stop | Stop the current llama-server process |

The inspect endpoint reads only the 24-byte fixed GGUF header plus filesystem metadata. It does not parse the tensor payload.

## Security boundaries

- The bridge binds only to 127.0.0.1.
- The browser Origin is checked before start/stop/inspect control calls.
- Model paths are relative and must stay below MODEL_DRIVE_ROOT.
- Only GGUF is executable in the current local llama.cpp path.
- Runtime status reports the relative model path rather than the full local path.
- Drive access tokens are not persisted by the repository Service Worker.
- Never commit OAuth secrets, refresh tokens, private model URLs, or model weights to GitHub.

## Validation

CI checks Python syntax, bridge unit tests, JavaScript syntax, and required governance files.

The remaining important validation is on a real Windows machine:

1. verify the OAuth return flow for the Model deployment origin;
2. scan the real Drive model root in the web UI;
3. launch a small known-good GGUF from a streamed/mounted Drive path;
4. measure cold start, Drive traffic/cache growth, RAM use and tokens/s.

## Status

See governance/PROJECT_STATE.md and governance/ARCHITECTURE.md.

Source pattern: Jvust/drive-original-player
Target project: Jvust2/Model
