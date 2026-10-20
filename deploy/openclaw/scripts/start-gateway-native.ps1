# Start isolated AIERP OpenClaw Gateway (Windows native) on 127.0.0.1:18789.
# - Stops only PIDs verified as this project's OpenClaw gateway.
# - Never puts Gateway Token on the process command line (env / config ${OPENCLAW_GATEWAY_TOKEN}).
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

if (-not (Test-Path $NativeCli)) { throw "OpenClaw CLI missing. Run install-windows-native.ps1 first." }

Import-NativeOpenclawEnv
Assert-GatewayPortSafeToBind
Stop-OwnedNativeGateway
Assert-GatewayPortSafeToBind
Start-Sleep -Seconds 1

Ensure-EvidenceDir
$log = Join-Path $EvidenceDir "gateway-run.log"
$err = Join-Path $EvidenceDir "gateway-run.err.log"

# Token must already be in process env (Import-NativeOpenclawEnv). Do NOT pass --token / --force.
$argList = @(
  "gateway", "run",
  "--bind", "loopback",
  "--port", "$NativeGatewayPort",
  "--auth", "token",
  "--ambient-channels"
)

$launcher = Start-Process -FilePath $NativeCli `
  -ArgumentList $argList `
  -WorkingDirectory $NativePrefix `
  -WindowStyle Hidden `
  -PassThru `
  -RedirectStandardOutput $log `
  -RedirectStandardError $err

Write-Host "launcher_pid=$($launcher.Id)"
Write-Host "ui=http://127.0.0.1:$NativeGatewayPort/"
Write-Host "auth=env:OPENCLAW_GATEWAY_TOKEN (not on cmdline)"

# Wait for owned node listener (openclaw.cmd is a short-lived launcher).
$gatewayPid = 0
$ok = $false
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 1
  $owned = @(Get-OwnedNativeGatewayPids)
  if ($owned.Count -gt 0) {
    $gatewayPid = [int]$owned[0]
    if (Test-GatewayHttpOk) { $ok = $true; break }
  }
}
if ($gatewayPid -gt 0) {
  Set-Content -LiteralPath $NativePidFile -Value "$gatewayPid" -Encoding ASCII
  Write-Host "gateway_pid=$gatewayPid"
} else {
  Write-Warning "No owned gateway listener detected yet; check $err"
}
if (-not $ok) {
  Write-Warning "Gateway process started but HTTP not ready yet; check $err / $log (cold start can take 60-120s on low disk)"
} else {
  Write-Host "http_status=200"
}

$checkPid = if ($gatewayPid -gt 0) { $gatewayPid } else { [int]$launcher.Id }
if (Test-GatewayCommandLineHasToken -ProcessId $checkPid) {
  throw "SECURITY: Gateway token still present on process command line — aborting. Fix start args."
}
Write-Host "cmdline_token_leak=false"
