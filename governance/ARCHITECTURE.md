# Architecture

## Data path

```text
Browser / GitHub Pages
  │
  ├─ OAuth Bridge
  │     ↓
  │  Google Drive API
  │     ├─ folder discovery
  │     ├─ metadata scan
  │     ├─ model_metadata.json
  │     └─ short-lived access token
  │
  ├─ model package index
  │
  └─ localhost Runtime Bridge (127.0.0.1)
          │
          ├─ Windows tray/autostart host
          ├─ browser auto-reconnect
          ├─ memory-only Drive session
          ├─ direct Drive API downloader
          ├─ resumable local cache
          ├─ backend detection / planning
          └─ llama.cpp launch / chat
                    ↓
          local cache file
                    ↓
              llama-server
                    ↓
               CPU / GPU
```

Google Drive for desktop is not part of the architecture.

## Why a local cache still exists

Google Drive API can provide file bytes and HTTP Range responses, but standard llama.cpp expects a seekable local file and commonly uses native file access/memory mapping.

The current safe baseline is therefore:

1. discover the model through Drive API;
2. download/resume the selected GGUF into a local cache;
3. launch llama.cpp from that complete cache file.

This removes the desktop Drive dependency without pretending llama.cpp can natively seek inside a remote HTTP object.

## Browser → Runtime Drive session

The website already obtains a short-lived Drive access token through the OAuth Bridge.

When localhost Runtime is reachable, the browser calls:

```text
POST /v1/drive/session
{ "access_token": "..." }
```

The token is:

- kept only in Runtime memory;
- never written to runtime.json;
- never written to cache metadata;
- replaced when the website refreshes it.

## Drive cache

Default Windows cache:

```text
%LOCALAPPDATA%\JvustModel\cache
```

Cache file names are derived from a SHA-256 hash of Drive file IDs, rather than raw names/IDs.

Each cached file has a small metadata sidecar containing non-secret data such as Drive file ID, original file name, size and checksum.

Interrupted downloads use a `.part` file and resume with a Range request when possible.

## Runtime endpoints

- `GET /health`
- `GET /v1/runtime`
- `GET /v1/backends`
- `POST /v1/drive/session`
- `POST /v1/models/cache`
- `POST /v1/models/plan`
- `POST /v1/models/inspect`
- `POST /v1/models/start`
- `POST /v1/models/stop`
- `POST /v1/chat/completions`

## GGUF startup

`POST /v1/models/start` receives:

- Drive file ID
- original Drive file name
- file size
- optional md5 checksum
- optional resource key
- display name / relative path metadata

If the cache is valid, Runtime launches immediately.

If the file is not cached, Runtime enters `downloading`, streams from Drive API in the background, updates progress, validates the completed GGUF, and then launches llama.cpp.

## Multi-backend packages

Model packages remain registry-first:

- GGUF → llama.cpp
- image/video → ComfyUI / Diffusers
- OCR/multimodal/RAG → Transformers
- time-series → PyTorch
- ONNX → ONNX Runtime

Only GGUF has a complete direct Drive cache → launch adapter today.

## Security invariants

1. Runtime listens only on localhost.
2. Browser Origin is checked.
3. Drive tokens are memory-only.
4. Drive IDs are validated before use.
5. Cache paths are generated from hashes, never from untrusted relative paths.
6. OAuth secrets/tokens are never committed to GitHub.
7. Cached model files can be deleted without losing canonical data because Drive is authoritative.


## Web-first Windows lifecycle

Normal users should not manually start the bridge.

One-time installation:

```text
runtime/Install.cmd
  ↓
copy runtime → %LOCALAPPDATA%\JvustModel\app
  ↓
save llama-server path
  ↓
register HKCU current-user auto-start
  ↓
start hidden tray host
```

Later sessions:

```text
Windows login
  ↓
background.ps1
  ↓
localhost Runtime
  ↑
Model website auto-reconnects
```

The tray host exposes Open Model, Runtime status, logs, restart, and exit actions. It is intentionally a current-user background app rather than an administrator-level Windows service.
