# Project State

Updated: 2026-09-25

## Mission

Build a Drive-first AI model website where model files remain in Google Drive while inference executes on the user's current computer.

## Current state

Status: **v0.3 website chat path in progress**

Implemented on branch `feat/drive-model-runtime-v1`:

- Static website shell designed for GitHub Pages.
- Google Drive OAuth/session client scaffold.
- Recursive Drive model discovery.
- Session-scoped model-tree index.
- Range-only Drive Service Worker.
- GGUF-first local llama-server bridge.
- CPU-first runtime policy with optional GPU offload.
- GGUF fixed-header inspection before launch.
- Runtime phase tracking: idle/loading/ready/failed.
- llama.cpp `/health` readiness polling.
- Web chat panel on the same site as the Drive model library.
- Local bridge proxy to llama.cpp `/v1/chat/completions`.
- Bounded chat request validation for roles, history size, temperature and max tokens.
- GitHub Pages deployment workflow for the static site.
- Runtime diagnostics without exposing the full absolute model path.
- 15 bridge unit tests covering path confinement, GGUF validation, load modes and chat request validation.

## Architecture invariants

1. GitHub stores code and governance, never model weights.
2. Google Drive remains the canonical model storage.
3. Local inference binds to localhost by default.
4. The public website is a control/UI layer; native inference remains local.
5. CPU operation works without requiring a GPU.
6. GPU offload is optional and explicit.
7. No silent full-model permanent download is allowed.
8. Temporary OS/Drive/browser cache is allowed and must be documented.
9. The web UI does not receive local filesystem write privileges.
10. Model execution paths stay below the configured Drive root.
11. GGUF/llama.cpp is the first execution path; other formats are indexed before they are executed.
12. A spawned model process is not considered ready until its health endpoint reports ready.
13. Chat requests go through the localhost bridge; the public site never exposes a remotely reachable inference port.

## Website flow

```text
GitHub Pages website
  │
  ├─ Google Drive API: discover/index model metadata
  │
  └─ localhost Runtime Bridge: start/stop/status/chat
                         │
                         ↓
                    llama-server
                         │
                         ↓
             streamed/mounted Drive path
                         │
                         ↓
                    Google Drive
```

## Known gaps

- GitHub Pages publishing source still needs to be enabled in repository settings if it is not already enabled.
- The existing OAuth Worker redirect behavior still needs verification against the final Model site origin.
- The browser Range reader cannot directly provide the seekable native file expected by llama.cpp.
- The runnable baseline therefore still requires a streamed/mounted Google Drive filesystem path.
- Real Windows + Drive + GGUF end-to-end validation has not yet been recorded.
- Chat is synchronous in v0.3; token streaming is a later enhancement.

## Next technical steps

1. Enable/verify GitHub Pages with GitHub Actions as the publishing source.
2. Verify OAuth return flow against the final Model Pages origin.
3. Scan a real Drive model root through the website and verify path mapping.
4. Launch a small known-good GGUF through Google Drive for desktop streaming mode.
5. Send a real chat request from the public website through localhost Runtime to llama.cpp.
6. Add streaming token rendering after the synchronous baseline is proven.
7. Benchmark cold-start Drive traffic/cache, RAM, readiness time and tokens/s.
8. Add a one-click Windows Runtime installer/launcher so normal use only requires opening the website.
9. Evaluate a virtual filesystem/sparse-cache adapter for direct Drive file-ID access after the mounted-drive baseline is measured.
