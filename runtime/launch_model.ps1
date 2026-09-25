param(
    [switch]$ResetConfig,
    [switch]$LocalSite,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$configDir = Join-Path $env:LOCALAPPDATA "JvustModel"
$configPath = Join-Path $configDir "runtime.json"
$publicSite = "https://jvust2.github.io/Model/"
$localSiteUrl = "http://127.0.0.1:8000/"
$bridgeUrl = "http://127.0.0.1:8765"

function Find-Python {
    $py = Get-Command "py.exe" -ErrorAction SilentlyContinue
    if ($py) {
        return [PSCustomObject]@{
            File = $py.Source
            PrefixArgs = @("-3")
        }
    }

    $python = Get-Command "python.exe" -ErrorAction SilentlyContinue
    if ($python) {
        return [PSCustomObject]@{
            File = $python.Source
            PrefixArgs = @()
        }
    }

    throw "Python 3 was not found. Install Python 3 and enable the Python launcher or add python.exe to PATH."
}

function Test-Config($config) {
    if (-not $config) { return $false }
    if (-not $config.driveRoot -or -not (Test-Path -LiteralPath $config.driveRoot -PathType Container)) {
        return $false
    }
    if (-not $config.llamaServerPath -or -not (Test-Path -LiteralPath $config.llamaServerPath -PathType Leaf)) {
        return $false
    }
    return $true
}

function Pick-Config {
    Add-Type -AssemblyName System.Windows.Forms

    $folder = New-Object System.Windows.Forms.FolderBrowserDialog
    $folder.Description = "Choose the Google Drive model root used by Model."
    $folder.ShowNewFolderButton = $false
    if ($folder.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        throw "Model setup cancelled before choosing the Drive model folder."
    }

    $file = New-Object System.Windows.Forms.OpenFileDialog
    $file.Title = "Choose llama-server.exe"
    $file.Filter = "llama-server.exe|llama-server.exe|Executable (*.exe)|*.exe"
    $file.CheckFileExists = $true
    $file.Multiselect = $false
    if ($file.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        throw "Model setup cancelled before choosing llama-server.exe."
    }

    return [PSCustomObject]@{
        driveRoot = (Resolve-Path -LiteralPath $folder.SelectedPath).Path
        llamaServerPath = (Resolve-Path -LiteralPath $file.FileName).Path
        bridgePort = 8765
        modelPort = 8080
        gpuLayers = 0
        loadMode = "none"
        readyWarnSeconds = 300
    }
}

function Save-Config($config) {
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    $config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configPath -Encoding UTF8
}

function Test-PublicSite {
    if ($LocalSite) { return $false }
    try {
        $response = Invoke-WebRequest -Uri $publicSite -Method Head -TimeoutSec 4 -UseBasicParsing
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
    } catch {
        return $false
    }
}

function Start-PythonProcess($python, [string[]]$args, [string]$workingDirectory) {
    $allArgs = @()
    $allArgs += $python.PrefixArgs
    $allArgs += $args
    return Start-Process -FilePath $python.File -ArgumentList $allArgs -WorkingDirectory $workingDirectory -PassThru -WindowStyle Hidden
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
    Write-Host "First-run setup: choose your Drive model folder and llama-server.exe." -ForegroundColor Cyan
    $config = Pick-Config
    Save-Config $config
}

$python = Find-Python

$env:MODEL_DRIVE_ROOT = $config.driveRoot
$env:LLAMA_SERVER_PATH = $config.llamaServerPath
$env:MODEL_BRIDGE_PORT = [string]$config.bridgePort
$env:MODEL_SERVER_PORT = [string]$config.modelPort
$env:MODEL_GPU_LAYERS = [string]$config.gpuLayers
$env:MODEL_LOAD_MODE = [string]$config.loadMode
$env:MODEL_READY_WARN_SECONDS = [string]$config.readyWarnSeconds

$bridgeProcess = $null
$siteProcess = $null

try {
    Write-Host ""
    Write-Host "Model" -ForegroundColor Cyan
    Write-Host "Drive root : $($config.driveRoot)"
    Write-Host "llama      : $($config.llamaServerPath)"
    Write-Host "Runtime    : $bridgeUrl"
    Write-Host "Config     : $configPath"
    Write-Host ""

    $bridgeProcess = Start-PythonProcess $python @("runtime\local_bridge.py") $repoRoot

    $bridgeReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        if ($bridgeProcess.HasExited) {
            throw "Local Runtime exited during startup. Re-run with -ResetConfig if the saved paths changed."
        }
        try {
            $health = Invoke-RestMethod -Uri "$bridgeUrl/health" -TimeoutSec 1
            if ($health.ok) {
                $bridgeReady = $true
                break
            }
        } catch {}
    }

    if (-not $bridgeReady) {
        throw "Local Runtime did not become reachable at $bridgeUrl."
    }

    if (Test-PublicSite) {
        $siteUrl = $publicSite
        Write-Host "Website    : $siteUrl" -ForegroundColor Green
    } else {
        $siteProcess = Start-PythonProcess $python @("-m", "http.server", "8000", "--bind", "127.0.0.1", "--directory", $repoRoot) $repoRoot
        Start-Sleep -Milliseconds 500
        if ($siteProcess.HasExited) {
            throw "Local website server exited during startup."
        }
        $siteUrl = $localSiteUrl
        Write-Host "Website    : $siteUrl (local fallback)" -ForegroundColor Yellow
    }

    if (-not $NoBrowser) {
        Start-Process $siteUrl
    }

    Write-Host ""
    Write-Host "Model is running. Keep this window open." -ForegroundColor Green
    Write-Host "Close this window or press Ctrl+C to stop the launcher."
    Write-Host "To change Drive/llama paths later: Model.cmd -ResetConfig"
    Write-Host ""

    Wait-Process -Id $bridgeProcess.Id
}
finally {
    try {
        Invoke-RestMethod -Uri "$bridgeUrl/v1/models/stop" -Method Post -ContentType "application/json" -Body "{}" -TimeoutSec 2 | Out-Null
    } catch {}

    if ($siteProcess -and -not $siteProcess.HasExited) {
        Stop-Process -Id $siteProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($bridgeProcess -and -not $bridgeProcess.HasExited) {
        Stop-Process -Id $bridgeProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
