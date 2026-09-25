# Project State

Updated: 2026-09-25

## Mission

Build a Drive-first AI model launcher where model files remain in Google Drive while inference executes on the user's current computer.

## Current state

Status: **v0.1 scaffold in progress**

Implemented on branch `feat/drive-model-runtime-v1`:

- Static model-library UI scaffold.
- Google Drive OAuth/session client scaffold.
- Recursive Drive model discovery.
- Session-scoped model-tree index.
- Range-only Service Worker for Drive model bytes.
- Local Python bridge for launching GGUF models through llama.cpp.
- CPU-first runtime policy.
- Explicit separation between Drive storage and local compute.

## Architecture invariants

1. GitHub stores code and governance, never model weights.
2. Google Drive remains the canonical model storage.
3. Local inference must bind to localhost by default.
4. CPU operation must work without requiring a GPU.
5. GPU offload is optional and explicit.
6. No silent full-model permanent download is allowed.
7. Temporary OS/Drive/browser cache is allowed and must be documented.
8. The web UI must not receive local filesystem write privileges.
9. Model execution paths must remain below the configured Drive root.
10. GGUF/llama.cpp is the first execution path; other formats are indexed before they are executed.

## Ported from drive-original-player

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

## Known gap

The browser Range reader cannot by itself make llama.cpp consume a remote HTTP model as a memory-mapped local file. v0.1 therefore uses a streamed/mounted Google Drive filesystem path for actual llama.cpp loading.

A later phase may add a virtual filesystem/sparse-cache adapter so the local runtime can address a Drive file ID directly.

## Next technical steps

1. Verify the existing OAuth Worker can return to the Model GitHub Pages origin.
2. Test recursive scan against a real Drive model folder.
3. Validate GGUF launch through Google Drive for desktop streaming mode.
4. Measure first-load network traffic, temporary cache size, RAM use and token speed.
5. Add GGUF metadata parsing without loading the full model.
6. Add runtime logs and graceful model switching.
7. Evaluate a virtual filesystem layer for direct Drive file-ID access.
