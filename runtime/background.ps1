param(
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

$baseDir = Join-Path $env:LOCALAPPDATA "JvustModel"
$appDir = Join-Path $baseDir "app"
$configPath = Join-Path $baseDir "runtime.json"
$logsDir = Join-Path $baseDir "logs"
$cacheDir = Join-Path $baseDir "cache"
$stdoutPath = Join-Path $logsDir "runtime.stdout.log"
$stderrPath = Join-Path $logsDir "runtime.stderr.log"
$trayPidPath = Join-Path $baseDir "tray.pid"
$siteUrl = "https://jvust2.github.io/Model/"
$bridgeUrl = "http://127.0.0.1:8765"

function Find-Python {
    $py = Get-Command "py.exe" -ErrorAction SilentlyContinue
    if ($py) {
        return [PSCustomObject]@{ File = $py.Source; PrefixArgs = @("-3") }
    }

    $python = Get-Command "python.exe" -ErrorAction SilentlyContinue
    if ($python) {
        return [PSCustomObject]@{ File = $python.Source; PrefixArgs = @() }
    }

    throw "Python 3.10+ was not found."
}

function Read-Config {
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw "Runtime config is missing. Run Install.cmd again."
    }
    return Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
}

function Start-Bridge {
    param($python, $config)

    $bridgeScript = Join-Path $appDir "local_bridge.py"
    if (-not (Test-Path -LiteralPath $bridgeScript -PathType Leaf)) {
        throw "Installed Runtime is incomplete. Run Install.cmd again."
    }

    if (-not (Test-Path -LiteralPath ([string]$config.llamaServerPath) -PathType Leaf)) {
        throw "llama-server.exe path is invalid. Run Install.cmd again."
    }

    New-Item -ItemType Directory -Force -Path $logsDir, $cacheDir | Out-Null
    Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue

    $env:LLAMA_SERVER_PATH = [string]$config.llamaServerPath
    $env:MODEL_BRIDGE_PORT = [string]$config.bridgePort
    $env:MODEL_SERVER_PORT = [string]$config.modelPort
    $env:MODEL_GPU_LAYERS = [string]$config.gpuLayers
    $env:MODEL_LOAD_MODE = [string]$config.loadMode
    $env:MODEL_READY_WARN_SECONDS = [string]$config.readyWarnSeconds
    $env:MODEL_CACHE_ROOT = $cacheDir

    $prefix = @(
        @($python.PrefixArgs) |
            Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } |
            ForEach-Object { [string]$_ }
    )
    $quotedBridge = '"' + $bridgeScript + '"'
    $argumentLine = (@($prefix) + @($quotedBridge)) -join " "

    $params = @{
        FilePath = $python.File
        ArgumentList = $argumentLine
        WorkingDirectory = $appDir
        WindowStyle = "Hidden"
        RedirectStandardOutput = $stdoutPath
        RedirectStandardError = $stderrPath
        PassThru = $true
    }

    return Start-Process @params
}

function Stop-Bridge($process) {
    try {
        Invoke-RestMethod -Uri "$bridgeUrl/v1/models/stop" -Method Post -ContentType "application/json" -Body "{}" -TimeoutSec 1 | Out-Null
    } catch {}

    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
}

if ($SelfTest) {
    Write-Host "Background script self-test passed."
    exit 0
}

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, "JvustModelRuntimeTray", [ref]$createdNew)
if (-not $createdNew) {
    exit 0
}

New-Item -ItemType Directory -Force -Path $baseDir | Out-Null
Set-Content -LiteralPath $trayPidPath -Value ([string]$PID) -Encoding ASCII

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$config = Read-Config
$python = Find-Python
$bridgeProcess = $null
$closing = $false
$lastStart = [DateTime]::MinValue

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Application
$notify.Text = "Model Runtime"
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add("Open Model")
$statusItem = $menu.Items.Add("Runtime: starting")
$logsItem = $menu.Items.Add("Open logs")
$restartItem = $menu.Items.Add("Restart Runtime")
$menu.Items.Add("-") | Out-Null
$exitItem = $menu.Items.Add("Exit Runtime")
$notify.ContextMenuStrip = $menu

$startBridgeAction = {
    if ($script:closing) { return }

    try {
        $health = Invoke-RestMethod -Uri "$bridgeUrl/health" -TimeoutSec 1
        if ($health.ok) {
            $statusItem.Text = "Runtime: connected"
            return
        }
    } catch {}

    if ($script:bridgeProcess -and -not $script:bridgeProcess.HasExited) {
        return
    }

    if (([DateTime]::Now - $script:lastStart).TotalSeconds -lt 2) {
        return
    }

    $script:lastStart = [DateTime]::Now
    try {
        $script:bridgeProcess = Start-Bridge $python $config
        $statusItem.Text = "Runtime: starting"
    } catch {
        $statusItem.Text = "Runtime: failed"
        $notify.ShowBalloonTip(
            5000,
            "Model Runtime",
            $_.Exception.Message,
            [System.Windows.Forms.ToolTipIcon]::Error
        )
    }
}

$openItem.add_Click({ Start-Process $siteUrl })
$notify.add_DoubleClick({ Start-Process $siteUrl })

$logsItem.add_Click({
    New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
    Start-Process explorer.exe $logsDir
})

$restartItem.add_Click({
    Stop-Bridge $script:bridgeProcess
    $script:bridgeProcess = $null
    $script:lastStart = [DateTime]::MinValue
    & $startBridgeAction
})

$exitItem.add_Click({
    $script:closing = $true
    Stop-Bridge $script:bridgeProcess
    $notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2500
$timer.add_Tick({
    if ($script:closing) { return }

    try {
        $health = Invoke-RestMethod -Uri "$bridgeUrl/health" -TimeoutSec 1
        if ($health.ok) {
            $statusItem.Text = "Runtime: connected"
            return
        }
    } catch {}

    $statusItem.Text = "Runtime: disconnected"
    & $startBridgeAction
})

& $startBridgeAction

$notify.ShowBalloonTip(
    2500,
    "Model Runtime",
    "后台引擎已启动。以后直接Open Model即可。",
    [System.Windows.Forms.ToolTipIcon]::Info
)

$timer.Start()

try {
    [System.Windows.Forms.Application]::Run()
}
finally {
    $timer.Stop()
    Stop-Bridge $script:bridgeProcess
    $notify.Visible = $false
    Remove-Item -LiteralPath $trayPidPath -Force -ErrorAction SilentlyContinue
    try { $mutex.ReleaseMutex() | Out-Null } catch {}
    $mutex.Dispose()
}
