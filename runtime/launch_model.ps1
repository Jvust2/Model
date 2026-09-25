param(
    [switch]$ResetConfig,
    [switch]$NoBrowser,
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configDir = Join-Path $env:LOCALAPPDATA "JvustModel"
$configPath = Join-Path $configDir "runtime.json"
$logDir = Join-Path $configDir "logs"
$cacheDir = Join-Path $configDir "cache"
$runtimeExe = Join-Path $scriptDir "ModelRuntime.exe"
$publicSite = "https://jvust2.github.io/Model/"
$bridgeUrl = "http://127.0.0.1:8765"

function Test-Config($config) {
    if (-not $config) { return $false }
    if (-not $config.llamaServerPath) { return $false }
    return Test-Path -LiteralPath ([string]$config.llamaServerPath) -PathType Leaf
}

function Pick-Config {
    Add-Type -AssemblyName System.Windows.Forms

    $file = New-Object System.Windows.Forms.OpenFileDialog
    $file.Title = "Choose llama-server.exe"
    $file.Filter = "llama-server.exe|llama-server.exe|Executable (*.exe)|*.exe"
    $file.CheckFileExists = $true
    $file.Multiselect = $false

    if ($file.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        throw "Model setup cancelled before choosing llama-server.exe."
    }

    return [PSCustomObject]@{
        llamaServerPath = (Resolve-Path -LiteralPath $file.FileName).Path
        bridgePort = 8765
        modelPort = 8080
        gpuLayers = 0
        loadMode = "none"
        readyWarnSeconds = 300
        installMode = "manual-exe"
    }
}

function Save-Config($config) {
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    $config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configPath -Encoding UTF8
}

if ($SelfTest) {
    Write-Host "Standalone launcher self-test passed."
    exit 0
}

if (-not (Test-Path -LiteralPath $runtimeExe -PathType Leaf)) {
    throw "ModelRuntime.exe is missing. Use the packaged release or run Install.cmd."
}

if ($ResetConfig -and (Test-Path -LiteralPath $configPath)) {
    Remove-Item -LiteralPath $configPath -Force
}

$config = $null
if (Test-Path -LiteralPath $configPath) {
    try {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    } catch {
        $config = $null
    }
}

if (-not (Test-Config $config)) {
    Write-Host "First-run setup: choose llama-server.exe." -ForegroundColor Cyan
    $config = Pick-Config
    Save-Config $config
}

New-Item -ItemType Directory -Force -Path $logDir, $cacheDir | Out-Null

$env:LLAMA_SERVER_PATH = [string]$config.llamaServerPath
$env:MODEL_BRIDGE_PORT = [string]$config.bridgePort
$env:MODEL_SERVER_PORT = [string]$config.modelPort
$env:MODEL_GPU_LAYERS = [string]$config.gpuLayers
$env:MODEL_LOAD_MODE = [string]$config.loadMode
$env:MODEL_READY_WARN_SECONDS = [string]$config.readyWarnSeconds
$env:MODEL_CACHE_ROOT = $cacheDir

$stdoutPath = Join-Path $logDir "runtime.stdout.log"
$stderrPath = Join-Path $logDir "runtime.stderr.log"
Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue

$process = Start-Process -FilePath $runtimeExe -WorkingDirectory $scriptDir -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru

try {
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250

        if ($process.HasExited) {
            $details = @()
            if (Test-Path -LiteralPath $stderrPath) {
                $details += Get-Content -LiteralPath $stderrPath -Tail 40 -ErrorAction SilentlyContinue
            }
            if (Test-Path -LiteralPath $stdoutPath) {
                $details += Get-Content -LiteralPath $stdoutPath -Tail 40 -ErrorAction SilentlyContinue
            }
            if ($details.Count -gt 0) {
                $details | ForEach-Object { Write-Host $_ -ForegroundColor Red }
            }
            throw "ModelRuntime.exe exited during startup."
        }

        try {
            $health = Invoke-RestMethod -Uri "$bridgeUrl/health" -TimeoutSec 1
            if ($health.ok) {
                $ready = $true
                break
            }
        } catch {}
    }

    if (-not $ready) {
        throw "Model Runtime did not become reachable at $bridgeUrl."
    }

    Write-Host ""
    Write-Host "Model Runtime is running." -ForegroundColor Green
    Write-Host "No system Python is required."
    Write-Host "Runtime: $bridgeUrl"
    Write-Host ""

    if (-not $NoBrowser) {
        Start-Process $publicSite
    }

    Wait-Process -Id $process.Id
}
finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
}
