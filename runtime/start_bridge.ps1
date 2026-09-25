param(
    [Parameter(Mandatory = $true)]
    [string]$DriveRoot,

    [Parameter(Mandatory = $true)]
    [string]$LlamaServerPath,

    [int]$BridgePort = 8765,
    [int]$ModelPort = 8080,
    [int]$GpuLayers = 0,
    [int]$Threads = 0,

    [ValidateSet("auto", "none", "mmap", "mlock", "mmap+mlock", "dio")]
    [string]$LoadMode = "none",

    [int]$ReadyWarnSeconds = 300
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $DriveRoot)) {
    throw "DriveRoot does not exist: $DriveRoot"
}

if (-not (Test-Path -LiteralPath $LlamaServerPath)) {
    throw "llama-server does not exist: $LlamaServerPath"
}

if ($BridgePort -le 0 -or $ModelPort -le 0) {
    throw "BridgePort and ModelPort must be positive."
}

if ($GpuLayers -lt 0) {
    throw "GpuLayers cannot be negative."
}

if ($ReadyWarnSeconds -le 0) {
    throw "ReadyWarnSeconds must be positive."
}

$env:MODEL_DRIVE_ROOT = (Resolve-Path -LiteralPath $DriveRoot).Path
$env:LLAMA_SERVER_PATH = (Resolve-Path -LiteralPath $LlamaServerPath).Path
$env:MODEL_BRIDGE_PORT = "$BridgePort"
$env:MODEL_SERVER_PORT = "$ModelPort"
$env:MODEL_GPU_LAYERS = "$GpuLayers"
$env:MODEL_LOAD_MODE = "$LoadMode"
$env:MODEL_READY_WARN_SECONDS = "$ReadyWarnSeconds"
Remove-Item Env:MODEL_NO_MMAP -ErrorAction SilentlyContinue

if ($Threads -gt 0) {
    $env:MODEL_THREADS = "$Threads"
}

Write-Host ""
Write-Host "Drive Model Local Runtime v0.2" -ForegroundColor Cyan
Write-Host "Drive root : $env:MODEL_DRIVE_ROOT"
Write-Host "llama      : $env:LLAMA_SERVER_PATH"
Write-Host "Bridge     : http://127.0.0.1:$BridgePort"
Write-Host "Model API  : http://127.0.0.1:$ModelPort"
Write-Host "GPU layers : $GpuLayers (0 = CPU only)"
Write-Host "Load mode  : $LoadMode"
Write-Host "Ready warn : $($ReadyWarnSeconds)s"
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

python runtime\local_bridge.py
