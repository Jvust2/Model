# Project State

Updated: 2026-09-25

## Mission

Build a Drive-first AI model launcher where model files remain in Google Drive while inference executes on the user's current computer.

## Current state

Status: **v0.2 runtime hardening in progress**

Implemented on branch feat/drive-model-runtime-v1:

- Static model-library UI.
- Google Drive OAuth/session client scaffold.
- Recursive Drive model discovery.
- Session-scoped model-tree index.
- Range-only Drive Service Worker.
- GGUF-first local llama-server bridge.
- CPU-first runtime policy with optional GPU offload.
- MODEL_LOAD_MODE support for current llama.cpp load modes.
- GGUF fixed-header inspection before launch.
- Runtime phase tracking: idle/loading/ready/failed.
- llama.cpp /health readiness polling.
- Runtime diagnostics for Drive root and llama-server availability.
- Relative-path-only runtime status to avoid exposing the full local model path.
- Unit tests for path confinement, GGUF header validation and load-mode validation.

## Architecture invariants

1. GitHub stores code and governance, never model weights.
2. Google Drive remains the canonical model storage.
3. Local inference binds to localhost by default.
4. CPU operation works without requiring a GPU.
5. GPU offload is optional and explicit.
6. No silent full-model permanent download is allowed.
7. Temporary OS/Drive/browser cache is allowed and must be documented.
8. The web UI does not receive local filesystem write privileges.
9. Model execution paths stay below the configured Drive root.
10. GGUF/llama.cpp is the first execution path; other formats are indexed before they are executed.
11. A spawned model process is not considered ready until its health endpoint reports ready.

## Ported from drive-original-player

Ported concepts:

- OAuth session pattern.
- Drive metadata scanning pattern.
- Range-request pattern.
- File-tree cache pattern.
- Resource-key support.
- Star visual identity.

Not ported:

- HTML video playback.
- MSE logic.
- Gallery viewer/slideshow.
- Video download controls.
- Media quality controls.

## Known gaps

- The browser Range reader cannot directly provide the seekable native file expected by llama.cpp.
- The current runnable path therefore requires a streamed/mounted Google Drive filesystem path.
- OAuth redirect behavior still needs to be verified against the Model deployment origin.
- Real hardware benchmarks have not yet been recorded for first-load bytes, temporary cache, RAM usage, startup time and token speed.
- GGUF inspection currently reads the fixed header only; rich metadata parsing is deferred.

## Next technical steps

1. Verify OAuth return flow against the Model deployment origin.
2. Scan a real Drive model root through the browser UI and verify index/path mapping.
3. Launch a small known-good GGUF from Google Drive for desktop streaming mode.
4. Record loading phase, /health readiness time and failure diagnostics.
5. Benchmark CPU-first inference: first-load network bytes, temporary cache, RAM, startup latency and tokens/s.
6. Add a benchmark/report command that records machine + model + runtime settings without storing secrets or weights.
7. Expand GGUF metadata parsing for architecture, context length and quantization metadata using bounded reads.
8. Evaluate a virtual filesystem/sparse-cache adapter for direct Drive file-ID access after the baseline is measured.
