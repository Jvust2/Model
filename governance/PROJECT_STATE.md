# Project State

Updated: 2026-09-25

## Mission

Build a Drive-first AI model website where model files remain in Google Drive while inference executes on the user's current Windows computer.

## Current state

Status: **v0.4 one-click website workflow in progress**

Implemented on branch feat/drive-model-runtime-v1:

- Static website prepared for GitHub Pages.
- Google Drive OAuth/session client scaffold.
- Recursive Drive model discovery and session-scoped index.
- Range-only Drive Service Worker.
- GGUF-first localhost llama-server bridge.
- CPU-first runtime with optional GPU offload.
- GGUF fixed-header inspection before launch.
- idle/loading/ready/failed runtime phases.
- llama.cpp /health readiness polling.
- Same-page local chat through /v1/chat/completions.
- Bounded chat request validation.
- GitHub Pages deployment workflow.
- Windows one-click launcher: runtime/Model.cmd.
- First-run GUI selection of Drive model root and llama-server.exe.
- Local configuration saved under %LOCALAPPDATA%/JvustModel, outside the repository.
- Automatic public-site detection with localhost website fallback.
- Linux CI for Python/JS/tests and Windows CI for PowerShell launcher syntax.

## Architecture invariants

1. GitHub stores code and governance, never model weights.
2. Google Drive remains the canonical model storage.
3. Local inference binds to localhost by default.
4. The public website is only UI/control; native inference remains local.
5. CPU operation works without requiring a GPU.
6. GPU offload is optional and explicit.
7. No silent permanent full-model download is allowed.
8. Temporary OS/Drive/browser cache is allowed and documented.
9. The website has no local filesystem write privilege.
10. Model execution paths stay below the configured Drive root.
11. GGUF/llama.cpp is the first executable path.
12. A spawned model is not ready until llama.cpp health reports ready.
13. The public site never exposes a remotely reachable inference port.
14. Local launcher configuration contains paths only, not Drive/OAuth credentials.

## Normal user flow

    Double-click runtime/Model.cmd
              ↓
    Runtime starts
              ↓
    Public site opens, or localhost fallback
              ↓
    Connect Drive / scan models
              ↓
    Select and start GGUF
              ↓
    Wait until ready
              ↓
    Chat in browser

## Known gaps

- GitHub Pages appears not enabled or is not readable through the current GitHub connection; repository Settings still needs verification.
- The OAuth Worker endpoint could not be externally inspected from the current browsing environment, so the final Model redirect still requires a real browser test.
- The current runtime requires a mounted/streamed Google Drive filesystem path.
- Real Windows + Drive + GGUF chat has not yet been end-to-end validated.
- Chat is synchronous; streaming tokens are a later enhancement.
- The one-click launcher can locate Python from PATH but does not yet install Python or llama.cpp automatically.

## Next technical steps

1. Enable/verify GitHub Pages publishing through GitHub Actions.
2. Run the Windows launcher CI and correct any Windows-only syntax/behavior issues.
3. Verify OAuth return flow in the real browser.
4. Start a small known-good GGUF from the Drive mount.
5. Complete an actual website chat round trip.
6. Add token streaming.
7. Add benchmark capture for load/cache/RAM/tokens-per-second.
8. Evaluate optional automatic llama.cpp setup after the manual-path baseline is proven.
9. Evaluate virtual filesystem/sparse-cache direct Drive-file access after baseline measurements.
