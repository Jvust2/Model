# Project State

Updated: 2026-09-25

## Mission

Build a Drive-first AI model website: Google Drive API provides the cloud model library, while inference executes on the user's Windows computer.

## Current state

Status: **v0.5 Google API website path restored**

Implemented on branch `feat/drive-model-runtime-v1`:

- Google Drive OAuth/session flow.
- Google Drive API v3 metadata access.
- Automatic discovery of root-level `AI-Model-Vault`.
- Manual folder ID fallback.
- Recursive Drive model discovery.
- Session-scoped metadata index.
- Range-only Drive Service Worker.
- GGUF-first localhost llama-server bridge.
- Cloud Drive relative path → local mounted Drive path mapping.
- Root-name mismatch warning between cloud selection and Runtime.
- CPU-first runtime with optional GPU offload.
- GGUF fixed-header inspection.
- idle/loading/ready/failed runtime phases.
- llama.cpp health polling.
- Same-page local chat via `/v1/chat/completions`.
- GitHub Pages workflow.
- Windows one-click Runtime launcher.
- Linux + Windows CI.

## Architecture invariants

1. Google Drive API is the website's model discovery source.
2. Google Drive remains the canonical model storage.
3. GitHub stores code/governance only.
4. Native inference remains local.
5. Website Drive root and `MODEL_DRIVE_ROOT` must refer to the same Drive folder.
6. CPU operation works without GPU.
7. GPU offload is explicit.
8. No silent permanent full-model download.
9. Runtime binds to localhost.
10. Model paths are relative and confined below the configured local root.
11. GGUF/llama.cpp is the first executable path.
12. Model readiness requires llama.cpp health success.
13. OAuth secrets/tokens are never committed to GitHub.

## Current user flow

    Open website
       ↓
    Connect Google Drive
       ↓
    Auto-find AI-Model-Vault
       ↓
    Scan Drive models
       ↓
    Start runtime/Model.cmd
       ↓
    Select/start GGUF
       ↓
    Ready
       ↓
    Chat

## Known gaps

- Final OAuth redirect to the Model Pages origin still needs a real browser verification.
- GitHub Pages repository setting still needs verification/enabling if disabled.
- Real Windows + Drive mount + Drive API + GGUF chat round trip has not yet been recorded.
- Chat is synchronous; token streaming is not yet implemented.
- Direct Drive-file-ID native inference remains future work.

## Next technical steps

1. Run CI for the restored Google API website path.
2. Verify OAuth bridge redirect on the final Model site.
3. Verify automatic `AI-Model-Vault` discovery.
4. Use matching local `MODEL_DRIVE_ROOT`.
5. Run a small GGUF end to end.
6. Add token streaming.
7. Add benchmark capture.
8. Evaluate sparse-cache / virtual filesystem direct Drive-file-ID access.
