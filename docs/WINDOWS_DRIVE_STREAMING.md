# Windows direct Google Drive API model loading

The old Google Drive Desktop streaming path is deprecated.

Model now uses:

    Google Drive API
      ↓
    localhost Runtime
      ↓
    resumable local cache
      ↓
    llama.cpp / backend

## Requirements

- Windows
- Python 3.10+
- `llama-server.exe`
- enough local disk space for the selected model cache

Google Drive for desktop is not required.

## Automatic launcher

Run:

    runtime\Model.cmd

Connect Drive in the web UI. The web OAuth token is transferred only to localhost Runtime memory.

## Manual bridge

Example:

    .\runtime\start_bridge.ps1 -LlamaServerPath "D:\llama.cpp\llama-server.exe"

Optional custom cache:

    .\runtime\start_bridge.ps1 -LlamaServerPath "D:\llama.cpp\llama-server.exe" -CacheRoot "D:\ModelCache"

## Cache behavior

The first GGUF launch downloads from Drive API.

Interrupted transfers keep a `.part` file and use HTTP Range to resume when supported.

Later launches reuse the valid complete cache.

## Why full local cache instead of pure remote random access?

Standard llama.cpp expects a seekable local file and may use memory mapping/native filesystem access. A full-file cache is the reliable baseline.

A future sparse-cache or virtual filesystem adapter may reduce local storage requirements, but it should only replace this baseline after correctness and performance are verified.
