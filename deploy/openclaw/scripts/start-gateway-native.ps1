# Start isolated AIERP OpenClaw Gateway (Windows native path) on 127.0.0.1:18789
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
$prefix = Join-Path $env:LOCALAPPDATA "aierp-openclaw"
$nodeDir = Join-Path $prefix "node\node-v24.16.0-win-x64"
$cli = Join-Path $prefix "node_modules\.bin\openclaw.cmd"
$state = Join-Path $prefix "state"
if (-not (Test-Path $cli)) { throw "OpenClaw CLI missing. Run install-windows-native.ps1 first." }
if (-not (Test-Path $EnvFile)) { throw "Missing $EnvFile" }

Get-Content $EnvFile | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $k, $v = $_.Split('=', 2)
  Set-Item -Path "Env:$($k.Trim())" -Value $v.Trim()
}
$env:PATH = "$nodeDir;" + $env:PATH
$env:OPENCLAW_STATE_DIR = $state
$env:OPENCLAW_HOME = $prefix
$env:OPENCLAW_CONFIG_PATH = Join-Path $state "openclaw.json"

# Stop previous listener on 18789
Get-NetTCPConnection -LocalPort 18789 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

Ensure-EvidenceDir
$log = Join-Path $EvidenceDir "gateway-run.log"
$err = Join-Path $EvidenceDir "gateway-run.err.log"
$p = Start-Process -FilePath $cli `
  -ArgumentList @("gateway", "run", "--bind", "loopback", "--port", "18789", "--auth", "token", "--token", $env:OPENCLAW_GATEWAY_TOKEN, "--force", "--ambient-channels") `
  -WorkingDirectory $prefix -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $log -RedirectStandardError $err
Write-Host "gateway_pid=$($p.Id)"
Write-Host "ui=http://127.0.0.1:18789/"
Write-Host "Paste OPENCLAW_GATEWAY_TOKEN from deploy/openclaw/.env into Control UI Settings."
