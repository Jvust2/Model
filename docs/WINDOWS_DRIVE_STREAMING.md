# Windows: run models from Google Drive streaming storage

This is the recommended v0.1 path when the goal is:

- model source stays in Google Drive;
- inference runs on the current Windows computer;
- a complete permanent copy is not intentionally placed in a normal local model folder.

## 1. Use a streamed Drive filesystem

Use Google Drive for desktop in **streaming** mode rather than mirroring the whole model library.

The result should look like a normal Windows path, for example:

```text
G:\My Drive\Models\Qwen\model.gguf
```

The exact drive letter and folder names may differ.

Important: streaming does not mean zero local disk use. Google Drive for desktop may keep temporary blocks/cache locally as the native runtime reads the model. The canonical model remains in Drive, but temporary cache behavior is controlled by the Drive client.

## 2. Install llama.cpp

Build or install llama.cpp and locate:

```text
llama-server.exe
```

The Model project does not bundle llama.cpp binaries.

## 3. Start the Local Runtime Bridge

From PowerShell in this repository:

```powershell
.\runtime\start_bridge.ps1 `
  -DriveRoot "G:\My Drive\Models" `
  -LlamaServerPath "D:\llama.cpp\llama-server.exe"
```

The defaults are:

- Bridge: `http://127.0.0.1:8765`
- llama-server: `http://127.0.0.1:8080`
- GPU layers: `0` (CPU only)
- `--no-mmap`: enabled

`--no-mmap` is enabled because network/streamed filesystems are a different workload from local SSD model files. It asks llama.cpp to use normal reads instead of relying on memory mapping.

## 4. Open the web UI

For a local test:

```powershell
python -m http.server 8000
```

Open:

```text
http://127.0.0.1:8000/
```

The Local Runtime Bridge allows this origin by default.

## 5. Connect Google Drive

The web UI uses the same OAuth session pattern as `drive-original-player`.

After authorization:

1. Enter the Drive model folder ID.
2. Scan.
3. GGUF files appear in the model library.
4. Click **本机启动**.

The relative Drive path sent by the web UI must match the folder layout under `MODEL_DRIVE_ROOT`.

Example:

```text
Drive folder selected in browser:
Models/

Indexed model:
Qwen/model.gguf

MODEL_DRIVE_ROOT:
G:\My Drive\Models

Runtime resolves:
G:\My Drive\Models\Qwen\model.gguf
```

## 6. CPU vs GPU

CPU is the default:

```text
MODEL_GPU_LAYERS=0
```

To experiment with GPU offload, pass a non-zero value:

```powershell
.\runtime\start_bridge.ps1 `
  -DriveRoot "G:\My Drive\Models" `
  -LlamaServerPath "D:\llama.cpp\llama-server.exe" `
  -GpuLayers 20
```

Whether a model fits depends on model size, quantization, context length, RAM/VRAM and llama.cpp build options.

## What is not implemented yet

The browser Service Worker can already prove that Drive model bytes support Range reads, but llama.cpp does not consume that browser endpoint directly.

A future virtual filesystem/sparse-cache layer can map a Drive file ID into a seekable local-file abstraction. Until then, the streamed Drive mount is the simplest native-runtime bridge.
