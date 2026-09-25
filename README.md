# Model

Drive-first local AI website.

Google Drive is the canonical model vault. The website discovers model packages with Google Drive API, while the local Windows Runtime downloads selected models directly from Drive API into a local cache and runs them on the current computer.

**Google Drive for desktop is not required.**

## Current flow

    Open Model website
          ↓
    Connect Google Drive
          ↓
    Auto-find AI-Model-Vault
          ↓
    Scan model metadata
          ↓
    Select a GGUF
          ↓
    Browser sends temporary Drive session to localhost Runtime
          ↓
    Runtime downloads/resumes the GGUF into local cache
          ↓
    llama.cpp launches from cache
          ↓
    Chat in the same website

## One-time Windows install

For normal use, install the background Runtime once:

    runtime\Install.cmd

The installer:

- asks for `llama-server.exe` only when it cannot find one automatically;
- copies the Runtime to `%LOCALAPPDATA%\JvustModel\app`;
- enables current-user Windows auto-start;
- starts a tray Runtime in the background;
- opens the Model website.

After that, normal use is simply:

    open https://jvust2.github.io/Model/

The website automatically reconnects to the local Runtime. You do not need to run `Model.cmd` every time.

To remove the background Runtime:

    runtime\Uninstall.cmd

Use `runtime\Model.cmd` only as a manual/debug launcher.

Default model cache:

    %LOCALAPPDATA%\JvustModel\cache

Runtime config:

    %LOCALAPPDATA%\JvustModel\runtime.json

Runtime logs:

    %LOCALAPPDATA%\JvustModel\logs

## Drive session security

The browser sends the current short-lived Google Drive access token to:

    http://127.0.0.1:8765/v1/drive/session

The Runtime keeps it in memory only. It is not persisted in config or cache metadata.

## Download/cache behavior

GGUF models are downloaded directly through Google Drive API.

- existing complete cache → reuse immediately;
- interrupted download → resume from `.part` when Drive honors Range;
- completed file → validate GGUF header, then launch llama.cpp.

Large models still need enough local disk space for the cache. The desktop Drive app is not needed.

## Backend routing

Current targets:

- GGUF → llama.cpp
- image/video → ComfyUI / Diffusers
- OCR/multimodal/RAG → Transformers
- time-series → PyTorch
- ONNX → ONNX Runtime
- TFLite → TFLite

Only GGUF currently has the complete automatic Drive-download-to-launch path.

See `docs/MULTI_BACKEND.md` for the remaining family adapters.

## Website

Production:

    https://jvust2.github.io/Model/

## Source of truth

- GitHub: code, governance, current project state.
- Google Drive: model artifacts and model metadata registry.
