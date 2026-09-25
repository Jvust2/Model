# Model

Drive-first local AI website: keep model files in Google Drive while inference runs on the current Windows computer.

## What it is

Model turns the Drive-first idea into a website workflow:

    Open Model website
          ↓
    Connect Google Drive
          ↓
    Browse / select a GGUF
          ↓
    Start local Runtime
          ↓
    llama.cpp loads the Drive-mounted model
          ↓
    Chat on the same website

Google Drive remains the canonical source for model files. GitHub stores code and governance only. The local computer provides CPU/GPU inference.

## Current v0.3 website

The website now includes:

- Google Drive sign-in and recursive model discovery.
- Model library with path, format and size.
- Drive Range probe.
- GGUF fixed-header validation.
- Local model start/stop controls.
- Loading / ready / failed state.
- Runtime logs.
- Built-in local chat UI.
- Temperature and max-token controls.
- Responsive desktop/mobile layout.
- GitHub Pages deployment workflow.

## One-click Windows launcher

For normal use, run:

    runtime\Model.cmd

First run asks for only:

1. your Google Drive model root;
2. llama-server.exe.

Those paths are saved locally in:

    %LOCALAPPDATA%\JvustModel\runtime.json

Later runs reuse the saved configuration, start the localhost bridge, and open the Model website automatically.

If the public GitHub Pages site is not available yet, the launcher automatically falls back to:

    http://127.0.0.1:8000/

To change the saved paths:

    runtime\Model.cmd -ResetConfig

See docs/WINDOWS_ONE_CLICK.md for details.

## Runtime architecture

    GitHub Pages website
            │
            ├── Google Drive API: model metadata / Range tests
            │
            └── 127.0.0.1:8765
                     │
                     ↓
              Local Runtime Bridge
                     │
                     ↓
                llama-server
                     │
                     ↓
           mounted/streamed Drive path
                     │
                     ↓
                Google Drive

The public website never exposes llama.cpp directly to the network. Chat requests go to the localhost bridge, which forwards them to llama.cpp's OpenAI-compatible local endpoint.

## Runtime configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| MODEL_DRIVE_ROOT | required | Mounted/streamed Google Drive model root |
| LLAMA_SERVER_PATH | llama-server | llama.cpp server executable |
| MODEL_BRIDGE_PORT | 8765 | Local bridge HTTP port |
| MODEL_SERVER_PORT | 8080 | llama-server port |
| MODEL_THREADS | CPU count - 2 | CPU inference threads |
| MODEL_GPU_LAYERS | 0 | GPU layers; 0 is CPU-only |
| MODEL_LOAD_MODE | none | llama.cpp load mode |
| MODEL_READY_WARN_SECONDS | 300 | Slow-load warning threshold |
| MODEL_HEALTH_INTERVAL | 0.5 | llama.cpp health polling interval |
| MODEL_CHAT_TIMEOUT | 600 | Local chat request timeout |
| MODEL_ALLOWED_ORIGINS | localhost + Jvust2 GitHub Pages | Origins allowed to control the bridge |

## Security boundaries

- Runtime binds to localhost.
- Browser Origin is checked before Runtime control/chat calls.
- Model paths are relative and confined below MODEL_DRIVE_ROOT.
- Only GGUF is executable in the current llama.cpp path.
- Full local absolute model paths are not returned to the website.
- Runtime launcher config stores only local filesystem paths.
- OAuth secrets, refresh tokens and model weights must never be committed to GitHub.

## Deployment

The static site is prepared for GitHub Pages through .github/workflows/pages.yml.

Pages still needs GitHub Actions selected as the repository publishing source before the first production deployment if Pages is currently disabled.

Expected site:

    https://jvust2.github.io/Model/

## Validation still needed on the real PC

1. Enable/verify GitHub Pages.
2. Verify OAuth returns to the final Model site.
3. Run runtime/Model.cmd.
4. Scan the real Drive model root.
5. Start a small known-good GGUF.
6. Send a real chat message from the site.
7. Record load time, cache/network use, RAM and tokens/s.

Source pattern: Jvust/drive-original-player
Target project: Jvust2/Model
