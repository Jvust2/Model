# Architecture

## Data path

```text
Browser / GitHub Pages
  │
  ├─ OAuth Bridge
  │     ↓
  │  Google Drive API
  │     ├─ folder discovery
  │     ├─ recursive model metadata scan
  │     └─ Range diagnostics
  │
  └─ localhost Runtime Bridge (127.0.0.1)
          │
          ├─ start / stop / status / inspect / chat
          │
          ↓
      llama-server
          │
          ↓
  Google Drive desktop mount
          │
          ↓
      Google Drive
```

## Web UI responsibilities

- Authenticate with Google Drive through the OAuth bridge.
- Automatically find the preferred root folder name, currently `AI-Model-Vault`.
- Preserve a manual folder-ID fallback.
- Recursively enumerate supported model files through Drive API v3.
- Store metadata-only model index in session storage.
- Show format, size and Drive-relative path.
- Send GGUF relative paths to localhost Runtime.
- Chat through the localhost bridge after llama.cpp becomes ready.

The browser does not receive native filesystem access.

## Drive API responsibilities

Drive API is used for cloud identity and metadata, not inference.

Stored/indexed fields may include:

- Drive file ID
- file name
- MIME type
- size
- modified time
- checksum when available
- resource key
- relative path

Model bytes are not persisted by the website.

## Service Worker

The Service Worker keeps the Range-only diagnostic path:

```text
/drive-model/<fileId>?size=<bytes>&resourceKey=<key>
```

It is for validating Drive byte-range behavior and future virtual-file experiments. A request without a Range header is rejected for model files.

## Local Runtime Bridge

The bridge binds to localhost and exposes:

- `GET /health`
- `GET /v1/runtime`
- `POST /v1/models/inspect`
- `POST /v1/models/start`
- `POST /v1/models/stop`
- `POST /v1/chat/completions`

The Runtime receives only a relative model path, resolves it below `MODEL_DRIVE_ROOT`, prevents path escape, validates GGUF, and starts llama.cpp.

Runtime status exposes only the local root basename (`drive_root_label`) rather than the full absolute root path.

## Cloud-to-local path invariant

The website Drive root and `MODEL_DRIVE_ROOT` must refer to the same folder.

Drive API:

```text
AI-Model-Vault/
  llm/Qwen/model.gguf
```

Local mount:

```text
G:\My Drive\AI-Model-Vault\llm\Qwen\model.gguf
```

The shared relative path is:

```text
llm/Qwen/model.gguf
```

This is the bridge between Drive API discovery and native local inference.

## Why not use Drive API bytes directly for llama.cpp?

Drive API supports byte-range reads, but normal llama.cpp expects a seekable native file and commonly uses OS-level file access/memory mapping. The mounted-drive baseline is therefore kept until a virtual filesystem or sparse-cache adapter is proven.

## Security invariants

1. GitHub never stores model weights or OAuth secrets.
2. Drive API uses read-only access for the website.
3. Runtime binds to localhost.
4. Browser Origins are checked before local control/chat requests.
5. Relative model paths are confined below `MODEL_DRIVE_ROOT`.
6. The website does not receive local filesystem write access.
7. Full local absolute model paths are not returned to the public site.
