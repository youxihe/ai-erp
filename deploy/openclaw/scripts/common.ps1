# Shared helpers for AIERP OpenClaw management (Windows host + Docker Desktop).
$ErrorActionPreference = "Stop"

$OpenclawRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ComposeFile = Join-Path $OpenclawRoot "docker-compose.yml"
$EnvFile = Join-Path $OpenclawRoot ".env"
$WorkspaceSrc = Join-Path $OpenclawRoot "workspace"
$EvidenceDir = Join-Path $OpenclawRoot "logs"

function Get-OpenclawComposeArgs {
  @("-f", $ComposeFile, "--env-file", $EnvFile)
}

function Invoke-OpenclawCompose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeArgs)
  if (-not (Test-Path $EnvFile)) {
    throw "Missing trusted env file: $EnvFile (copy .env.example and fill secrets; chmod/ACL restrict)."
  }
  & docker compose @((Get-OpenclawComposeArgs) + $ComposeArgs)
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed: $($ComposeArgs -join ' ')" }
}

function Invoke-OpenclawCli {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs)
  # One-shot CLI sharing gateway network namespace requires gateway up for network_mode.
  # Use --no-deps entrypoint on gateway image when gateway is down.
  $running = docker ps --filter "name=aierp-openclaw-gateway" --filter "status=running" -q
  if ($running) {
    & docker compose @(Get-OpenclawComposeArgs) --profile cli run --rm --no-deps openclaw-cli @CliArgs
  } else {
    & docker compose @(Get-OpenclawComposeArgs) run --rm --no-deps --entrypoint node openclaw-gateway @("dist/index.js") + $CliArgs
  }
  if ($LASTEXITCODE -ne 0) { throw "openclaw cli failed: $($CliArgs -join ' ')" }
}

function Get-GatewayToken {
  if (-not (Test-Path $EnvFile)) { return $null }
  $line = Get-Content $EnvFile | Where-Object { $_ -match '^\s*OPENCLAW_GATEWAY_TOKEN=' } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace '^\s*OPENCLAW_GATEWAY_TOKEN=', '').Trim().Trim('"').Trim("'")
}

function Write-Redacted {
  param([string]$Text)
  $t = $Text
  $t = $t -replace 'sk-[a-zA-Z0-9]{10,}', 'sk-***REDACTED***'
  $t = $t -replace '(botId|secret|token|api[_-]?key)("?\s*[:=]\s*"?)[^",\s}]+', '$1***REDACTED***'
  return $t
}

function Ensure-EvidenceDir {
  if (-not (Test-Path $EvidenceDir)) { New-Item -ItemType Directory -Path $EvidenceDir | Out-Null }
}
