# Model

Drive-first local AI website: use Google Drive API for the web model library, while inference runs on the current Windows computer.

## Product flow

    Open Model website
          ↓
    Connect Google Drive (OAuth)
          ↓
    Auto-find AI-Model-Vault
          ↓
    Scan model metadata with Drive API
          ↓
    Select a GGUF
          ↓
    Local Runtime maps the relative path below MODEL_DRIVE_ROOT
          ↓
    llama.cpp loads from the Google Drive desktop mount
          ↓
    Chat on the same website

Google Drive remains the canonical model storage. GitHub stores code/governance only. The local computer provides CPU/GPU inference.

## Why both Drive API and Google Drive desktop?

They solve different parts:

- **Google Drive API + OAuth**: website login, cloud folder discovery, metadata, file IDs, Range diagnostics.
- **Google Drive for desktop**: exposes a seekable filesystem path that native llama.cpp can load.
- **Local Runtime**: safely maps the Drive API relative path below the configured local Drive root and launches llama.cpp.

The API does not perform inference and does not require Google Cloud GPU.

## Website

Current website includes:

- Google Drive OAuth through the existing OAuth bridge.
- Automatic discovery of a root-level folder named `AI-Model-Vault`.
- Manual folder ID fallback.
- Recursive Drive model metadata scan.
- Session-scoped model index.
- Drive Range probe.
- GGUF local-path validation and fixed-header inspection.
- Local start/stop and readiness state.
- Built-in local chat.
- Runtime log/diagnostic panel.
- Warning when the cloud Drive root name and the local Runtime root name differ.
- GitHub Pages deployment workflow.

No private Drive folder ID is committed to GitHub.

## One-click Windows Runtime

Run:

    runtime\Model.cmd

First run asks for:

1. the local Google Drive desktop folder corresponding to the website's model root;
2. `llama-server.exe`.

The paths are saved locally at:

    %LOCALAPPDATA%\JvustModel\runtime.json

Later runs reuse those paths and open the Model website automatically.

## Runtime architecture

    GitHub Pages
        │
        ├── OAuth Bridge
        │       ↓
        │   Google Drive API
        │       ↓
        │   cloud model metadata / Range reads
        │
        └── http://127.0.0.1:8765
                    ↓
             Local Runtime Bridge
                    ↓
               llama-server
                    ↓
        Google Drive desktop mount
                    ↓
               model GGUF

The public site never exposes llama.cpp directly to the network.

## Root-path invariant

The folder selected by the website and the folder configured as `MODEL_DRIVE_ROOT` must represent the same Drive folder.

Example:

    Website Drive root: AI-Model-Vault
    MODEL_DRIVE_ROOT: G:\My Drive\AI-Model-Vault

A Drive API relative path such as:

    llm/Qwen/model.gguf

must resolve locally as:

    G:\My Drive\AI-Model-Vault\llm\Qwen\model.gguf

The website warns when the cloud root name and local Runtime root name differ.

## Deployment

The static website is prepared for GitHub Pages with `.github/workflows/pages.yml`.

Expected site after Pages is enabled and this work reaches `main`:

    https://jvust2.github.io/Model/

## Validation still needed on the real PC

1. Verify/enable GitHub Pages.
2. Verify the existing OAuth bridge redirects back to the final Model site.
3. Connect Google Drive and auto-find `AI-Model-Vault`.
4. Run `runtime\Model.cmd` with the matching local Drive folder.
5. Start a known-good small GGUF.
6. Complete a real web chat round trip.
7. Benchmark cold-load traffic/cache, RAM and tokens/s.

Source pattern: `Jvust/drive-original-player`
Target: `Jvust2/Model`
