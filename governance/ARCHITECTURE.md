# Architecture

## Data path

```text
Browser UI
  │
  ├─ Google Drive API: list metadata only
  │
  ├─ Service Worker: range-only model-byte experiments
  │
  └─ localhost bridge: start/stop/status
                         │
                         ↓
                  llama.cpp server
                         │
                         ↓
              mounted/streamed Drive path
                         │
                         ↓
                    Google Drive
```

## Components

### Web UI

Responsibilities:

- Authenticate to Google Drive through the OAuth bridge.
- Select a root folder.
- Recursively enumerate folders and supported model files.
- Show model format, size and relative path.
- Send a selected GGUF relative path to the localhost bridge.

The web UI does not run native inference directly.

### Model index

The model index is metadata-only and uses `sessionStorage`.

It may store:

- Drive file ID
- name
- MIME type
- size
- modified time
- checksum when available
- resource key
- relative path

It must not store model bytes.

### Service Worker

The Service Worker provides a range-only endpoint:

```text
/drive-model/<fileId>?size=<bytes>&resourceKey=<key>
```

This is useful for validating random-access reads and future virtual-file work. It intentionally does not fetch a whole model when the browser omits a Range header.

### Local Runtime Bridge

The bridge is a localhost control plane.

Initial endpoints:

- `GET /health`
- `GET /v1/runtime`
- `POST /v1/models/start`
- `POST /v1/models/stop`

The bridge accepts a relative path only, joins it below `MODEL_DRIVE_ROOT`, validates the result, then launches llama.cpp.

### Actual model I/O in v0.1

The runnable path is a mounted/streamed Google Drive filesystem such as Google Drive for desktop streaming mode.

This preserves Drive as the source of truth while allowing native runtimes such as llama.cpp to receive the seekable filesystem path they expect.

## Why not feed the browser Service Worker directly into llama.cpp?

A browser Service Worker can serve HTTP byte ranges, but normal llama.cpp model loading expects a seekable filesystem file and commonly uses memory mapping. A separate virtual filesystem or sparse-file adapter is required to bridge those models safely and efficiently.

That adapter is intentionally deferred until the baseline runtime is measured.
