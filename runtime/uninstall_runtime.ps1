param(
    [switch]$PurgeCache
)

$ErrorActionPreference = "Stop"

$baseDir = Join-Path $env:LOCALAPPDATA "JvustModel"
$appDir = Join-Path $baseDir "app"
$cacheDir = Join-Path $baseDir "cache"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runName = "JvustModelRuntime"

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
