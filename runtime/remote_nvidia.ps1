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
        throw "Model Runtime is not installed. Run runtime\Install.cmd first."
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
    throw "Tailscale was not found. Install and sign in to Tailscale on this NVIDIA Windows host first."
}

$config = Read-Config
if (
    -not $PSBoundParameters.ContainsKey("ServePort") -and
    $config.remoteServePort
) {
    $ServePort = [int]$config.remoteServePort
}

if ($Disable) {
    & $tailscale serve --https=$ServePort off | Out-Null
    Set-ConfigProperty $config "remoteEnabled" $false
    Set-ConfigProperty $config "remoteUrl" ""
    Set-ConfigProperty $config "remoteToken" ""
    Set-ConfigProperty $config "remoteMode" ""
    Set-ConfigProperty $config "remoteServePort" $ServePort
    Save-Config $config
    Restart-ModelRuntime
    Write-Host ""
    Write-Host "Remote NVIDIA Runtime disabled." -ForegroundColor Yellow
    Write-Host "Runtime remains available locally on http://127.0.0.1:8765."
    exit 0
}

$statusRaw = & $tailscale status --json
if ($LASTEXITCODE -ne 0 -or -not $statusRaw) {
    throw "Tailscale is not running or is not signed in."
}
$status = ($statusRaw -join [Environment]::NewLine) | ConvertFrom-Json
$dnsName = [string]$status.Self.DNSName
$dnsName = $dnsName.Trim().TrimEnd(".")
if (-not $dnsName) {
    throw "Tailscale did not return a MagicDNS name. Verify that Tailscale is connected."
}

$token = [string]$config.remoteToken
if ($RotateToken -or [string]::IsNullOrWhiteSpace($token)) {
    $token = New-RemoteToken
}

$remoteUrl = if ($ServePort -eq 443) {
    "https://" + $dnsName
} else {
    "https://" + $dnsName + ":" + $ServePort
}

Set-ConfigProperty $config "remoteEnabled" $true
Set-ConfigProperty $config "remoteUrl" $remoteUrl
Set-ConfigProperty $config "remoteToken" $token
Set-ConfigProperty $config "remoteMode" "tailscale-serve"
Set-ConfigProperty $config "remoteServePort" $ServePort
Save-Config $config

# Keep Model Runtime bound to localhost. Tailscale Serve provides private
# tailnet HTTPS. Never replace this with Tailscale Funnel.
& $tailscale serve --bg --yes --https=$ServePort http://127.0.0.1:8765
if ($LASTEXITCODE -ne 0) {
    throw "Tailscale Serve failed to enable the remote Runtime listener."
}

Restart-ModelRuntime
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "Remote NVIDIA Runtime enabled." -ForegroundColor Green
Write-Host "Runtime URL  : $remoteUrl"
Write-Host "Runtime Token: $token"
Write-Host ""
Write-Host "On another device in the same tailnet:"
Write-Host "1. Open the Model website."
Write-Host "2. Open Advanced diagnostics."
Write-Host "3. Set Runtime Bridge to the HTTPS URL above."
Write-Host "4. Enter the Runtime Token above."
Write-Host "5. Click Reconnect."
Write-Host ""
Write-Host "To disable remote sharing, run runtime\Disable-Remote-Nvidia.cmd."
