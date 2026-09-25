param(
    [switch]$PurgeCache
)

$ErrorActionPreference = "Stop"

$baseDir = Join-Path $env:LOCALAPPDATA "JvustModel"
$appDir = Join-Path $baseDir "app"
$cacheDir = Join-Path $baseDir "cache"
$trayPidPath = Join-Path $baseDir "tray.pid"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runName = "JvustModelRuntime"

if (Test-Path -LiteralPath $trayPidPath -PathType Leaf) {
    try {
        $trayPid = [int](Get-Content -LiteralPath $trayPidPath -Raw)
        if ($trayPid -gt 0 -and $trayPid -ne $PID) {
            Stop-Process -Id $trayPid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 300
        }
    } catch {}
    Remove-Item -LiteralPath $trayPidPath -Force -ErrorAction SilentlyContinue
}

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 1
    if ($health.service -eq "Drive Model Local Runtime") {
        $listener = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($listener -and $listener.OwningProcess) {
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
} catch {}

Remove-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $appDir -Recurse -Force -ErrorAction SilentlyContinue

if ($PurgeCache) {
    Remove-Item -LiteralPath $cacheDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Model Runtime background app removed." -ForegroundColor Green
if (-not $PurgeCache) {
    Write-Host "Model cache/config kept at: $baseDir"
}
