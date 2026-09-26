param(
    [switch]$Disable,
    [switch]$RotateToken,
    [switch]$SelfTest,
    [ValidateRange(1, 65535)]
    [int]$ServePort = 8443
)

$ErrorActionPreference = "Stop"

$baseDir = Join-Path $env:LOCALAPPDATA "JvustModel"
$appDir = Join-Path $baseDir "app"
$configPath = Join-Path $baseDir "runtime.json"
$backgroundPath = Join-Path $appDir "background.ps1"
$installedExe = Join-Path $appDir "ModelRuntime.exe"

function Find-Tailscale {
    foreach ($name in @("tailscale.exe", "tailscale")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) { return $command.Source }
    }

    $candidate = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return $candidate
    }
    return $null
}

function Read-Config {
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw "Model Runtime 尚未安装。请先运行 runtime\Install.cmd。"
    }
    return Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
}

function Set-ConfigProperty($config, [string]$name, $value) {
    $property = $config.PSObject.Properties[$name]
    if ($property) {
        $property.Value = $value
    } else {
        $config | Add-Member -NotePropertyName $name -NotePropertyValue $value
    }
}

function Save-Config($config) {
    $config | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $configPath -Encoding UTF8
}

function New-RemoteToken {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return ([BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
}

function Restart-ModelRuntime {
    if (Test-Path -LiteralPath $installedExe -PathType Leaf) {
        Get-CimInstance Win32_Process -Filter "Name='ModelRuntime.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.ExecutablePath -ieq $installedExe } |
            ForEach-Object {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
    }

    Start-Sleep -Milliseconds 600

    $trayRunning = $false
    $trayPidPath = Join-Path $baseDir "tray.pid"
    if (Test-Path -LiteralPath $trayPidPath -PathType Leaf) {
        try {
            $trayPid = [int](Get-Content -LiteralPath $trayPidPath -Raw)
            $trayRunning = $null -ne (Get-Process -Id $trayPid -ErrorAction SilentlyContinue)
        } catch {}
    }

    if (-not $trayRunning -and (Test-Path -LiteralPath $backgroundPath -PathType Leaf)) {
        $args = '-NoProfile -ExecutionPolicy Bypass -File "' + $backgroundPath + '"'
        Start-Process powershell.exe -WindowStyle Hidden -ArgumentList $args
    }
}

if ($SelfTest) {
    Write-Host "Remote NVIDIA setup script self-test passed."
    exit 0
}

$tailscale = Find-Tailscale
if (-not $tailscale) {
    throw "未找到 Tailscale。请先在这台 NVIDIA Windows 机器安装并登录 Tailscale。"
}

$config = Read-Config

if ($Disable) {
    & $tailscale serve --https=$ServePort off | Out-Null
    Set-ConfigProperty $config "remoteEnabled" $false
    Set-ConfigProperty $config "remoteUrl" ""
    Set-ConfigProperty $config "remoteToken" ""
    Save-Config $config
    Restart-ModelRuntime
    Write-Host ""
    Write-Host "Remote NVIDIA Runtime 已关闭。" -ForegroundColor Yellow
    Write-Host "Runtime 仍只在本机 localhost:8765 可用。"
    exit 0
}

$statusRaw = & $tailscale status --json
if ($LASTEXITCODE -ne 0 -or -not $statusRaw) {
    throw "Tailscale 未运行或尚未登录。"
}
$status = ($statusRaw -join "`n") | ConvertFrom-Json
$dnsName = [string]$status.Self.DNSName
$dnsName = $dnsName.Trim().TrimEnd(".")
if (-not $dnsName) {
    throw "Tailscale 没有返回 MagicDNS 名称；请确认 Tailscale 已连接。"
}

$token = [string]$config.remoteToken
if ($RotateToken -or [string]::IsNullOrWhiteSpace($token)) {
    $token = New-RemoteToken
}

$remoteUrl = if ($ServePort -eq 443) {
    "https://$dnsName"
} else {
    "https://$dnsName`:$ServePort"
}

Set-ConfigProperty $config "remoteEnabled" $true
Set-ConfigProperty $config "remoteUrl" $remoteUrl
Set-ConfigProperty $config "remoteToken" $token
Set-ConfigProperty $config "remoteMode" "tailscale-serve"
Set-ConfigProperty $config "remoteServePort" $ServePort
Save-Config $config

# Tailscale Serve keeps Model Runtime bound to localhost and publishes only
# through the private tailnet HTTPS endpoint. This is Serve, never Funnel.
& $tailscale serve --bg --yes --https=$ServePort http://127.0.0.1:8765
if ($LASTEXITCODE -ne 0) {
    throw "Tailscale Serve 启用失败。"
}

Restart-ModelRuntime
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "Remote NVIDIA Runtime 已启用" -ForegroundColor Green
Write-Host "Runtime URL : $remoteUrl"
Write-Host "Runtime Token: $token"
Write-Host ""
Write-Host "在另一台已加入同一 tailnet 的设备上："
Write-Host "1. 打开 Model 网站"
Write-Host "2. 高级诊断 -> Runtime Bridge 填上面的 HTTPS 地址"
Write-Host "3. 远程 Runtime 令牌填上面的 Token"
Write-Host "4. 点击“重新连接”"
Write-Host ""
Write-Host "关闭远程共享：运行 runtime\Disable-Remote-Nvidia.cmd"
