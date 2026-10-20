# Shared helpers for AIERP OpenClaw management.
# Active runtime on this host: Windows native under %LOCALAPPDATA%\aierp-openclaw.
# Docker Compose helpers remain for optional fallback only.
$ErrorActionPreference = "Stop"

$OpenclawRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ComposeFile = Join-Path $OpenclawRoot "docker-compose.yml"
$EnvFile = Join-Path $OpenclawRoot ".env"
$WorkspaceSrc = Join-Path $OpenclawRoot "workspace"
$EvidenceDir = Join-Path $OpenclawRoot "logs"

$NativePrefix = Join-Path $env:LOCALAPPDATA "aierp-openclaw"
$NativeStateDir = Join-Path $NativePrefix "state"
$NativeWorkspaceDir = Join-Path $NativeStateDir "workspace"
$NativeCli = Join-Path $NativePrefix "node_modules\.bin\openclaw.cmd"
# Prefer repo deploy/openclaw/backups (usually D:, gitignored). C: LOCALAPPDATA may be disk-full.
$NativeBackupRoot = Join-Path $OpenclawRoot "backups"
$NativePidFile = Join-Path $NativeStateDir "gateway.pid"
$NativeGatewayPort = 18789
$NativeNodeMarker = "aierp-openclaw"

function Get-OpenclawComposeArgs {
  @("-f", $ComposeFile, "--env-file", $EnvFile)
}

function Test-NativeOpenclawInstalled {
  return (Test-Path $NativeCli) -and (Test-Path (Join-Path $NativeStateDir "openclaw.json"))
}

function Get-OpenclawRuntimeMode {
  param([ValidateSet("auto", "native", "docker")][string]$Mode = "auto")
  if ($Mode -ne "auto") { return $Mode }
  if (Test-NativeOpenclawInstalled) { return "native" }
  $dockerUp = $false
  try {
    $id = docker ps --filter "name=aierp-openclaw-gateway" --filter "status=running" -q 2>$null
    if ($id) { $dockerUp = $true }
  } catch { }
  if ($dockerUp) { return "docker" }
  if (Test-Path $ComposeFile) { return "docker" }
  throw "No OpenClaw runtime detected (native missing under $NativePrefix; Docker gateway not running)."
}

function Get-NativeNodeDir {
  $exe = Get-ChildItem (Join-Path $NativePrefix "node") -Recurse -Filter node.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match 'node-v2[4-9]' } |
    Select-Object -First 1
  if (-not $exe) { throw "Node 24+ missing under $NativePrefix\node. Run install-windows-native.ps1." }
  return $exe.Directory.FullName
}

function Import-OpenclawEnvFile {
  param([string]$Path = $EnvFile)
  if (-not (Test-Path $Path)) { throw "Missing trusted env file: $Path" }
  Get-Content -LiteralPath $Path | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $k, $v = $_.Split('=', 2)
    Set-Item -Path "Env:$($k.Trim())" -Value $v.Trim()
  }
}

function Import-NativeOpenclawEnv {
  # Prefer state\.env (runtime), fall back to repo deploy/openclaw/.env
  $stateEnv = Join-Path $NativeStateDir ".env"
  if (Test-Path $stateEnv) {
    Import-OpenclawEnvFile -Path $stateEnv
  } elseif (Test-Path $EnvFile) {
    Import-OpenclawEnvFile -Path $EnvFile
  } else {
    throw "Missing trusted .env at $stateEnv or $EnvFile"
  }
  $nodeDir = Get-NativeNodeDir
  $env:PATH = "$nodeDir;" + $env:PATH
  $env:OPENCLAW_STATE_DIR = $NativeStateDir
  $env:OPENCLAW_HOME = $NativePrefix
  $env:OPENCLAW_CONFIG_PATH = Join-Path $NativeStateDir "openclaw.json"
  if (-not $env:OPENCLAW_GATEWAY_TOKEN) {
    throw "OPENCLAW_GATEWAY_TOKEN missing from trusted .env (required for gateway auth; not passed on CLI)."
  }
}

function Invoke-NativeOpenclawCli {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs)
  if (-not (Test-Path $NativeCli)) { throw "Native OpenClaw CLI missing: $NativeCli" }
  Import-NativeOpenclawEnv
  & $NativeCli @CliArgs
  if ($LASTEXITCODE -ne 0) { throw "openclaw cli failed: $($CliArgs -join ' ')" }
}

function Get-ProcessCommandLine {
  param([int]$ProcessId)
  try {
    return (Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop).CommandLine
  } catch {
    return $null
  }
}

function Test-IsOwnedNativeGatewayProcess {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return $false }
  $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $proc) { return $false }
  # Ignore cmd/powershell launchers (openclaw.cmd); only the node gateway owns the port.
  if ($proc.ProcessName -notin @("node", "node.exe")) { return $false }
  $cmd = Get-ProcessCommandLine -ProcessId $ProcessId
  if (-not $cmd) { return $false }
  # Must be our isolated prefix + openclaw gateway (not ERP / random listeners).
  $isOurs = ($cmd -like "*$NativeNodeMarker*") -and ($cmd -match 'openclaw') -and ($cmd -match 'gateway\s+run')
  return [bool]$isOurs
}

function Get-ListenersOnGatewayPort {
  Get-NetTCPConnection -LocalPort $NativeGatewayPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
}

function Get-OwnedNativeGatewayPids {
  $pids = @()
  foreach ($procId in (Get-ListenersOnGatewayPort)) {
    if (Test-IsOwnedNativeGatewayProcess -ProcessId $procId) { $pids += $procId }
  }
  if (Test-Path $NativePidFile) {
    $saved = 0
    [void][int]::TryParse((Get-Content -LiteralPath $NativePidFile -ErrorAction SilentlyContinue | Select-Object -First 1), [ref]$saved)
    if ($saved -gt 0 -and (Get-Process -Id $saved -ErrorAction SilentlyContinue) -and (Test-IsOwnedNativeGatewayProcess -ProcessId $saved)) {
      if ($pids -notcontains $saved) { $pids += $saved }
    }
  }
  return $pids | Select-Object -Unique
}

function Assert-GatewayPortSafeToBind {
  $foreign = @()
  foreach ($procId in (Get-ListenersOnGatewayPort)) {
    if (-not (Test-IsOwnedNativeGatewayProcess -ProcessId $procId)) {
      $cmd = Get-ProcessCommandLine -ProcessId $procId
      $foreign += "PID=$procId cmd=$(Write-Redacted $cmd)"
    }
  }
  if ($foreign.Count -gt 0) {
    throw ("Port 127.0.0.1:$NativeGatewayPort is in use by non-AIERP OpenClaw process(es). Refusing to kill. " + ($foreign -join '; '))
  }
}

function Stop-OwnedNativeGateway {
  $owned = @(Get-OwnedNativeGatewayPids)
  if ($owned.Count -eq 0) {
    Write-Host "No owned native OpenClaw Gateway listener on port $NativeGatewayPort."
    return
  }
  foreach ($procId in $owned) {
    Write-Host "Stopping owned native gateway PID=$procId"
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    $still = @(Get-OwnedNativeGatewayPids)
    if ($still.Count -eq 0) { break }
    Start-Sleep -Milliseconds 300
  }
  if ((Get-OwnedNativeGatewayPids).Count -gt 0) {
    throw "Owned gateway did not exit cleanly; refusing broader process kill."
  }
  if (Test-Path $NativePidFile) { Remove-Item -LiteralPath $NativePidFile -Force -ErrorAction SilentlyContinue }
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
  $mode = Get-OpenclawRuntimeMode
  if ($mode -eq "native") {
    Invoke-NativeOpenclawCli @CliArgs
    return
  }
  $running = docker ps --filter "name=aierp-openclaw-gateway" --filter "status=running" -q
  if ($running) {
    & docker compose @(Get-OpenclawComposeArgs) --profile cli run --rm --no-deps openclaw-cli @CliArgs
  } else {
    & docker compose @(Get-OpenclawComposeArgs) run --rm --no-deps --entrypoint node openclaw-gateway @("dist/index.js") + $CliArgs
  }
  if ($LASTEXITCODE -ne 0) { throw "openclaw cli failed: $($CliArgs -join ' ')" }
}

function Get-GatewayToken {
  $candidates = @(
    (Join-Path $NativeStateDir ".env"),
    $EnvFile
  )
  foreach ($path in $candidates) {
    if (-not (Test-Path $path)) { continue }
    $line = Get-Content -LiteralPath $path | Where-Object { $_ -match '^\s*OPENCLAW_GATEWAY_TOKEN=' } | Select-Object -First 1
    if ($line) {
      return ($line -replace '^\s*OPENCLAW_GATEWAY_TOKEN=', '').Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

function Write-Redacted {
  param([string]$Text)
  if ($null -eq $Text) { return "" }
  $t = "$Text"
  $t = $t -replace 'sk-[a-zA-Z0-9]{10,}', 'sk-***REDACTED***'
  $t = $t -replace '(?i)(botId|bot_secret|secret|token|api[_-]?key)("?\s*[:=]\s*"?)[^",\s}]+', '$1***REDACTED***'
  $t = $t -replace '(?i)(--token\s+)\S+', '$1***REDACTED***'
  $t = $t -replace '[a-f0-9]{32,64}', '***HEX***'
  return $t
}

function Ensure-EvidenceDir {
  if (-not (Test-Path $EvidenceDir)) { New-Item -ItemType Directory -Path $EvidenceDir | Out-Null }
}

function Backup-NativeOpenclawState {
  param(
    [string]$Label = "",
    # When true, briefly stop owned gateway so SQLite/session files copy cleanly, then caller restarts.
    [switch]$Consistent
  )
  if (-not (Test-NativeOpenclawInstalled)) { throw "Native OpenClaw state missing under $NativeStateDir" }
  New-Item -ItemType Directory -Force -Path $NativeBackupRoot | Out-Null
  $stamp = Get-Date -Format "yyyyMMddHHmmss"
  $name = if ($Label) { "backup-$stamp-$Label" } else { "backup-$stamp" }
  $out = Join-Path $NativeBackupRoot $name
  New-Item -ItemType Directory -Force -Path $out | Out-Null

  $stoppedForBackup = $false
  if ($Consistent) {
    Assert-GatewayPortSafeToBind
    if (@(Get-OwnedNativeGatewayPids).Count -gt 0) {
      Write-Host "Stopping owned gateway for consistent backup..."
      Stop-OwnedNativeGateway
      $stoppedForBackup = $true
    }
  }

  # Sensitive: keep only under %LOCALAPPDATA% (never commit).
  # Short retries avoid hang on SQLite WAL locks when gateway stays up.
  $rcArgs = @(
    $NativeStateDir, $out,
    "/E", "/R:1", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np",
    "/XD", "cache", "tmp", "locks", "media",
    "/XF", "node24.zip"
  )
  if (-not $Consistent) {
    # Live backup: skip locked DB files; config/workspace/plugins still copied.
    $rcArgs += @("/XF", "*.sqlite", "*.sqlite-wal", "*.sqlite-shm")
  }
  & robocopy @rcArgs | Out-Null
  $rc = $LASTEXITCODE
  $LASTEXITCODE = 0
  if ($rc -ge 8) { throw "robocopy backup failed code=$rc" }

  # Must-have config/workspace even if robocopy skipped something
  foreach ($must in @("openclaw.json", ".env")) {
    $src = Join-Path $NativeStateDir $must
    if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $out $must) -Force }
  }
  if (Test-Path $NativeWorkspaceDir) {
    $wsOut = Join-Path $out "workspace"
    New-Item -ItemType Directory -Force -Path $wsOut | Out-Null
    Copy-Item -Path (Join-Path $NativeWorkspaceDir "*") -Destination $wsOut -Recurse -Force -ErrorAction SilentlyContinue
  }

  icacls $out /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" | Out-Null
  Write-Host "Backup OK (private): $out"
  if (-not $Consistent) {
    Write-Host "NOTE: Live backup skipped *.sqlite* (gateway running). Use backup.ps1 -Consistent for full session DB."
  }
  Write-Host "NOTE: Backup may contain sessions/credentials. Do not commit or share."
  if ($stoppedForBackup) {
    Write-Host "Gateway was stopped for consistent backup; start-gateway-native.ps1 / restart.ps1 to bring it back."
  }
  return $out
}

function Test-GatewayHttpOk {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$NativeGatewayPort/" -UseBasicParsing -TimeoutSec 5
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Test-GatewayCommandLineHasToken {
  param([int]$ProcessId)
  $cmd = Get-ProcessCommandLine -ProcessId $ProcessId
  if (-not $cmd) { return $false }
  # Flag only explicit --token <value> (not env-ref text in unrelated args)
  return [bool]($cmd -match '--token\s+\S+')
}
