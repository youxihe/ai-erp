# Fallback when Docker image pull is blocked: isolated OpenClaw under %LOCALAPPDATA%\aierp-openclaw
# Requires/downloads Node 24.16+ into that prefix. Does not use HR/ERP Docker networks.
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

$prefix = Join-Path $env:LOCALAPPDATA "aierp-openclaw"
$nodeRoot = Join-Path $prefix "node"
$state = Join-Path $prefix "state"
$workspaceDst = Join-Path $state "workspace"
New-Item -ItemType Directory -Force -Path $prefix, $nodeRoot, $state, $workspaceDst | Out-Null

if (-not (Test-Path $EnvFile)) { throw "Missing $EnvFile — copy .env.example and fill secrets first." }

# Ensure Node 24+
$nodeExe = Get-ChildItem $nodeRoot -Recurse -Filter node.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match 'node-v2[4-9]' } |
  Select-Object -First 1
if (-not $nodeExe) {
  $zip = Join-Path $prefix "node24.zip"
  $url = "https://nodejs.org/dist/v24.16.0/node-v24.16.0-win-x64.zip"
  Write-Host "Downloading Node 24.16.0..."
  curl.exe -L --retry 5 -o $zip $url
  Expand-Archive -Path $zip -DestinationPath $nodeRoot -Force
  $nodeExe = Get-ChildItem $nodeRoot -Recurse -Filter node.exe | Where-Object { $_.FullName -match 'node-v24' } | Select-Object -First 1
}
if (-not $nodeExe) { throw "Node 24 not found under $nodeRoot" }
$nodeDir = $nodeExe.Directory.FullName
$env:PATH = "$nodeDir;" + $env:PATH
& "$nodeDir\node.exe" -v

$env:OPENCLAW_STATE_DIR = $state
$env:OPENCLAW_HOME = $prefix
$env:OPENCLAW_CONFIG_PATH = Join-Path $state "openclaw.json"

# Load .env into process (no echo of values)
Get-Content $EnvFile | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $k, $v = $_.Split('=', 2)
  [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim(), "Process")
}

Set-Location $prefix
if (-not (Test-Path (Join-Path $prefix "package.json"))) { npm init -y | Out-Null }
npm install openclaw@latest --allow-scripts=openclaw
$cli = Join-Path $prefix "node_modules\.bin\openclaw.cmd"
if (-not (Test-Path $cli)) { throw "openclaw CLI missing after npm install" }
& $cli --version

# Seed workspace from repo templates (backup existing)
$stamp = Get-Date -Format "yyyyMMddHHmmss"
if (Test-Path $workspaceDst) {
  Copy-Item $workspaceDst "$workspaceDst.bak-$stamp" -Recurse -Force -ErrorAction SilentlyContinue
}
Copy-Item (Join-Path $WorkspaceSrc "*") $workspaceDst -Force

# Seed config if missing
$cfg = Join-Path $state "openclaw.json"
$example = Join-Path $OpenclawRoot "openclaw.example.json"
if (-not (Test-Path $cfg)) {
  Copy-Item $example $cfg
}

# Copy trusted .env next to state (chmod equivalent via ACL)
Copy-Item $EnvFile (Join-Path $state ".env") -Force
icacls (Join-Path $state ".env") /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null

Write-Host "Onboard DeepSeek..."
& $cli onboard --non-interactive --accept-risk --skip-health --mode local `
  --auth-choice deepseek-api-key --secret-input-mode ref `
  --gateway-auth token --gateway-token-ref-env OPENCLAW_GATEWAY_TOKEN `
  --skip-channels --no-install-daemon

Write-Host "Install plugins..."
& $cli plugins install @openclaw/deepseek-provider
& $cli plugins install @wecom/wecom-openclaw-plugin

& $cli config set agents.defaults.model.primary deepseek/deepseek-v4-flash
& $cli config set channels.wecom.enabled true
& $cli config set channels.wecom.connectionMode websocket
& $cli config set channels.wecom.dmPolicy pairing
& $cli config set channels.wecom.groupPolicy disabled
& $cli config set tools.profile messaging
& $cli config set gateway.bind lan
& $cli config set gateway.mode local

Write-Host "Install gateway service (loopback)..."
& $cli gateway install --port 18789 --bind lan 2>&1 | ForEach-Object { Write-Redacted ("$_") }
& $cli gateway start 2>&1 | ForEach-Object { Write-Redacted ("$_") }

Write-Host "UI: http://127.0.0.1:18789/"
Write-Host "State: $state"
Write-Host "CLI: $cli"
Write-Host "Next: openclaw doctor / channels status --probe ; WeCom DM 你好"
