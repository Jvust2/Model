# Windows Runtime installation

Download the latest successful `main` artifact from the [Runtime package workflow](https://github.com/Jvust2/Model/actions/workflows/runtime-package-drive-api.yml). Extract it, then double-click `runtime\Install.cmd`.

The artifact includes `ModelRuntime.exe`; the source tree does not. System Python is not required for the packaged Runtime. On first install, choose `llama-server.exe` if it is not found automatically. The installer enables the tray Runtime for the current Windows user and opens the website.

The default model cache is `D:\Model`. GGUF downloads and managed video/ComfyUI files stay there until explicitly removed. Google Drive remains the source of truth, and its access token is kept in Runtime memory only.

For manual diagnostics, run `runtime\Model.cmd` from the extracted package. To change the llama-server path, use `runtime\Model.cmd -ResetConfig`. To run without opening the browser, use `runtime\Model.cmd -NoBrowser`.

Configuration: `%LOCALAPPDATA%\JvustModel\runtime.json`

Logs: `%LOCALAPPDATA%\JvustModel\logs`

Normal use after installation: open [Model](https://jvust2.github.io/Model/), connect Google Drive, select a supported model, and start it from the website. The Runtime downloads selected Drive files only when needed and reuses the persistent local cache.
