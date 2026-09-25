param(
    [switch]$Repair,
    [switch]$NoStart,
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

$sourceRuntime = Split-Path -Parent $MyInvocation.MyCommand.Path
$baseDir = Join-Path $env:LOCALAPPDATA "JvustModel"
$appDir = Join-Path $baseDir "app"
$configPath = Join-Path $baseDir "runtime.json"
$logsDir = Join-Path $baseDir "logs"
$cacheDir = Join-Path $baseDir "cache"
$trayPidPath = Join-Path $baseDir "tray.pid"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runName = "JvustModelRuntime"
$siteUrl = "https://jvust2.github.io/Model/"

function Find-Python {
    $py = Get-Command "py.exe" -ErrorAction SilentlyContinue
    if ($py) {
        return [PSCustomObject]@{ File = $py.Source; PrefixArgs = @("-3") }
    }

    $python = Get-Command "python.exe" -ErrorAction SilentlyContinue
    if ($python) {
        return [PSCustomObject]@{ File = $python.Source; PrefixArgs = @() }
    }

    throw "Python 3.10+ was not found. Install Python first, then run Install.cmd again."
}

function Assert-PythonVersion($python) {
    $args = @($python.PrefixArgs) + @(
        "-c",
        "import sys; print(str(sys.version_info.major)+'.'+str(sys.version_info.minor)+'.'+str(sys.version_info.micro))"
    )
    $args = @($args | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    $text = (& $python.File @args 2>&1 | Select-Object -First 1)
    if (-not $text) { throw "Could not determine Python version." }

    $parts = [string]$text -split "\."
    if ($parts.Count -lt 2) { throw "Unexpected Python version: $text" }
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 10)) {
        throw "Python 3.10+ is required. Detected: $text"
    }
    return [string]$text
}

function Test-LlamaPath([string]$path) {
    return (
        -not [string]::IsNullOrWhiteSpace($path) -and
        (Test-Path -LiteralPath $path -PathType Leaf)
    )
}

function Find-LlamaServer {
    $command = Get-Command "llama-server.exe" -ErrorAction SilentlyContinue
    if ($command -and (Test-LlamaPath $command.Source)) {
        return $command.Source
    }

    $candidates = @()
    if ($env:LOCALAPPDATA) {
        $candidates += (Join-Path $env:LOCALAPPDATA "Programs\Ollama\lib\ollama\llama-server.exe")
    }
    if ($env:ProgramFiles) {
        $candidates += (Join-Path $env:ProgramFiles "Ollama\lib\ollama\llama-server.exe")
    }
    $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    if ($programFilesX86) {
        $candidates += (Join-Path $programFilesX86 "Ollama\lib\ollama\llama-server.exe")
    }

    $candidate = $candidates | Where-Object { $_ -and (Test-LlamaPath $_) } | Select-Object -First 1
    if ($candidate) {
        return (Resolve-Path -LiteralPath $candidate).Path
    }

    return $null
}

function Pick-LlamaServer {
    Add-Type -AssemblyName System.Windows.Forms
    $file = New-Object System.Windows.Forms.OpenFileDialog
    $file.Title = "Model: choose llama-server.exe once"
    $file.Filter = "llama-server.exe|llama-server.exe|Executable (*.exe)|*.exe"
    $file.CheckFileExists = $true
    $file.Multiselect = $false

    if ($file.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        throw "Installation cancelled before choosing llama-server.exe."
    }
    return (Resolve-Path -LiteralPath $file.FileName).Path
}

function Read-Config {
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        return $null
    }
    try {
        return Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Save-Config([string]$llamaPath) {
    $config = [PSCustomObject]@{
        llamaServerPath = $llamaPath
        bridgePort = 8765
        modelPort = 8080
        gpuLayers = 0
        loadMode = "none"
        readyWarnSeconds = 300
        installMode = "tray-autostart"
    }
    $config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configPath -Encoding UTF8
}

function Stop-ExistingTray {
    if (-not (Test-Path -LiteralPath $trayPidPath -PathType Leaf)) {
        return
    }

    try {
        $trayPid = [int](Get-Content -LiteralPath $trayPidPath -Raw)
        if ($trayPid -gt 0 -and $trayPid -ne $PID) {
            Stop-Process -Id $trayPid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 300
        }
    } catch {}

    Remove-Item -LiteralPath $trayPidPath -Force -ErrorAction SilentlyContinue
}

function Stop-ExistingRuntime {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 1
        if (-not $health -or $health.service -ne "Drive Model Local Runtime") {
            return
        }
    } catch {
        return
    }

    try {
        $listener = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction Stop |
            Select-Object -First 1
        if ($listener -and $listener.OwningProcess) {
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 400
        }
    } catch {}
}

function Startup-Command {
    $background = Join-Path $appDir "background.ps1"
    return 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $background + '"'
}

$required = @(
    "__init__.py",
    "backends.py",
    "drive_cache.py",
    "local_bridge.py",
    "background.ps1"
)

if ($SelfTest) {
    foreach ($name in $required) {
        $path = Join-Path $sourceRuntime $name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Installer self-test missing source file: $name"
        }
    }
    $python = Find-Python
    $version = Assert-PythonVersion $python
    Write-Host "Installer self-test passed. Python $version"
    exit 0
}

Write-Host ""
Write-Host "Model Runtime Installer" -ForegroundColor Cyan
Write-Host "This is a one-time install. Google Drive Desktop is not required." -ForegroundColor Green
Write-Host ""

$python = Find-Python
$pythonVersion = Assert-PythonVersion $python
Write-Host "Python     : $pythonVersion"

New-Item -ItemType Directory -Force -Path $baseDir, $appDir, $logsDir, $cacheDir | Out-Null

$config = Read-Config
$llamaPath = $null
if ($config -and (Test-LlamaPath ([string]$config.llamaServerPath))) {
    $llamaPath = (Resolve-Path -LiteralPath ([string]$config.llamaServerPath)).Path
}

if (-not $llamaPath) {
    $llamaPath = Find-LlamaServer
}
if (-not $llamaPath) {
    $llamaPath = Pick-LlamaServer
}

Stop-ExistingTray
Stop-ExistingRuntime

foreach ($name in $required) {
    Copy-Item -LiteralPath (Join-Path $sourceRuntime $name) -Destination (Join-Path $appDir $name) -Force
}

Save-Config $llamaPath

New-Item -Path $runKey -Force | Out-Null
New-ItemProperty -Path $runKey -Name $runName -PropertyType String -Value (Startup-Command) -Force | Out-Null

Write-Host "Installed   : $appDir"
Write-Host "Cache       : $cacheDir"
Write-Host "llama       : $llamaPath"
Write-Host "Auto-start  : enabled for current Windows user"
Write-Host ""

if (-not $NoStart) {
    $backgroundPath = Join-Path $appDir "background.ps1"
    $backgroundArgs = '-NoProfile -ExecutionPolicy Bypass -File "' + $backgroundPath + '"'
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList $backgroundArgs
    Start-Sleep -Seconds 1
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 2
        if ($health.ok) {
            Write-Host "Runtime     : running" -ForegroundColor Green
        }
    } catch {
        Write-Host "Runtime     : starting in background; use the tray icon for status/logs." -ForegroundColor Yellow
    }

    Start-Process $siteUrl
}

Write-Host ""
Write-Host "Done. From now on, normally just open the Model website." -ForegroundColor Green
Write-Host "You can close this installer window."
