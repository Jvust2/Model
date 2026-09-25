param(
    [switch]$ResetConfig,
    [switch]$LocalSite,
    [switch]$NoBrowser,
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$configDir = Join-Path $env:LOCALAPPDATA "JvustModel"
$configPath = Join-Path $configDir "runtime.json"
$logDir = Join-Path $configDir "logs"
$cacheDir = Join-Path $configDir "cache"
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

    throw "Python 3 was not found. Install Python 3.10+ or add python.exe to PATH."
}

function Get-PythonArgumentList($python, [string[]]$ProcessArgs) {
    return @(
        @($python.PrefixArgs) + @($ProcessArgs) |
            Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } |
            ForEach-Object { [string]$_ }
    )
}

function Assert-PythonVersion($python) {
    $versionArgs = Get-PythonArgumentList $python @(
        "-c",
        "import sys; print(str(sys.version_info.major)+'.'+str(sys.version_info.minor)+'.'+str(sys.version_info.micro))"
    )
    $versionText = (& $python.File @versionArgs 2>&1 | Select-Object -First 1)
    if (-not $versionText) {
        throw "Could not determine Python version."
    }

    $parts = [string]$versionText -split "\."
    if ($parts.Count -lt 2) {
        throw "Unexpected Python version output: $versionText"
    }

    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    Write-Host "Python     : $versionText"

    if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 10)) {
        throw "Python 3.10 or newer is required. Detected Python $versionText."
    }
}

function Test-Config($config) {
    if (-not $config) { return $false }
    if (-not $config.llamaServerPath) { return $false }
    if (-not (Test-Path -LiteralPath $config.llamaServerPath -PathType Leaf)) {
        return $false
    }
    return $true
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
    }
}

function Save-Config($config) {
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    $config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configPath -Encoding UTF8
}

function Start-PythonProcess(
    $python,
    [string[]]$ProcessArgs,
    [string]$workingDirectory,
    [string]$stdoutPath = "",
    [string]$stderrPath = ""
) {
    $allArgs = Get-PythonArgumentList $python $ProcessArgs

    $params = @{
        FilePath = $python.File
        WorkingDirectory = $workingDirectory
        PassThru = $true
        WindowStyle = "Hidden"
    }

    if ($allArgs.Count -gt 0) {
        $params.ArgumentList = $allArgs
    }
    if ($stdoutPath) {
        $params.RedirectStandardOutput = $stdoutPath
    }
    if ($stderrPath) {
        $params.RedirectStandardError = $stderrPath
    }

    return Start-Process @params
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

if ($SelfTest) {
    $hostExecutable = (Get-Process -Id $PID).Path
    $fakePython = [PSCustomObject]@{
        File = $hostExecutable
        PrefixArgs = @()
    }
    $testProcess = Start-PythonProcess $fakePython @("-NoProfile", "-Command", "exit 0") $repoRoot
    $testProcess.WaitForExit()
    if ($testProcess.ExitCode -ne 0) {
        throw "Start-PythonProcess self-test failed."
    }
    Write-Host "Start-PythonProcess self-test passed."
    exit 0
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
    Write-Host "Google Drive Desktop is NOT required." -ForegroundColor Green
    $config = Pick-Config
    Save-Config $config
}

$python = Find-Python
Assert-PythonVersion $python

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

$env:LLAMA_SERVER_PATH = $config.llamaServerPath
$env:MODEL_BRIDGE_PORT = [string]$config.bridgePort
$env:MODEL_SERVER_PORT = [string]$config.modelPort
$env:MODEL_GPU_LAYERS = [string]$config.gpuLayers
$env:MODEL_LOAD_MODE = [string]$config.loadMode
$env:MODEL_READY_WARN_SECONDS = [string]$config.readyWarnSeconds
$env:MODEL_CACHE_ROOT = $cacheDir

$runtimeStdout = Join-Path $logDir "runtime.stdout.log"
$runtimeStderr = Join-Path $logDir "runtime.stderr.log"
Remove-Item -LiteralPath $runtimeStdout -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $runtimeStderr -Force -ErrorAction SilentlyContinue

$bridgeProcess = $null
$siteProcess = $null

try {
    Write-Host ""
    Write-Host "Model Runtime" -ForegroundColor Cyan
    Write-Host "Drive      : Google Drive API (no desktop app)"
    Write-Host "Cache      : $cacheDir"
    Write-Host "llama      : $($config.llamaServerPath)"
    Write-Host "Runtime    : $bridgeUrl"
    Write-Host "Config     : $configPath"
    Write-Host ""

    $bridgeProcess = Start-PythonProcess $python @("runtime\local_bridge.py") $repoRoot $runtimeStdout $runtimeStderr

    $bridgeReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250

        if ($bridgeProcess.HasExited) {
            Start-Sleep -Milliseconds 150
            $details = @()

            if (Test-Path -LiteralPath $runtimeStderr) {
                $details += Get-Content -LiteralPath $runtimeStderr -Tail 40 -ErrorAction SilentlyContinue
            }
            if (Test-Path -LiteralPath $runtimeStdout) {
                $details += Get-Content -LiteralPath $runtimeStdout -Tail 40 -ErrorAction SilentlyContinue
            }

            Write-Host ""
            Write-Host "Runtime startup diagnostics:" -ForegroundColor Red
            if ($details.Count -gt 0) {
                $details | ForEach-Object { Write-Host $_ -ForegroundColor Red }
            } else {
                Write-Host "(no Python output captured)" -ForegroundColor Red
            }
            Write-Host "Logs: $logDir" -ForegroundColor Yellow
            Write-Host ""
            throw "Local Runtime exited during startup with code $($bridgeProcess.ExitCode)."
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
    Write-Host "Connect Google Drive in the website; models download into local cache on first launch."
    Write-Host "Close this window or press Ctrl+C to stop the launcher."
    Write-Host "To change llama-server.exe later: Model.cmd -ResetConfig"
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
