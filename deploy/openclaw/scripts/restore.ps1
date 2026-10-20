param(
  [Parameter(Mandatory = $true)][string]$BackupDir,
  [ValidateSet("auto", "native", "docker")][string]$Mode = "auto"
)
. (Join-Path $PSScriptRoot "common.ps1")
$BackupDir = (Resolve-Path $BackupDir).Path
$runtime = Get-OpenclawRuntimeMode -Mode $Mode
Write-Host "== OpenClaw restore (runtime=$runtime) from $BackupDir =="

if ($runtime -eq "native") {
  $hasConfig = (Test-Path (Join-Path $BackupDir "openclaw.json")) -or (Test-Path (Join-Path $BackupDir "state\openclaw.json"))
  if (-not $hasConfig) { throw "Invalid native backup: missing openclaw.json under $BackupDir" }

  # Safety: only restore into our native state dir
  Write-Host "Stopping owned native gateway..."
  Assert-GatewayPortSafeToBind
  Stop-OwnedNativeGateway

  $pre = Backup-NativeOpenclawState -Label "pre-restore"
  Write-Host "Pre-restore snapshot: $pre"

  $src = $BackupDir
  if (Test-Path (Join-Path $BackupDir "state\openclaw.json")) {
    $src = Join-Path $BackupDir "state"
  }

  # Preserve live .env unless backup includes one
  $liveEnv = Join-Path $NativeStateDir ".env"
  $envBak = Join-Path $env:TEMP "aierp-openclaw-live.env.bak"
  if (Test-Path $liveEnv) { Copy-Item -LiteralPath $liveEnv -Destination $envBak -Force }

  Write-Host "Restoring into $NativeStateDir ..."
  & robocopy $src $NativeStateDir /E /R:2 /W:1 /XD cache tmp locks media /XF *.sqlite *.sqlite-wal *.sqlite-shm /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy restore failed code=$LASTEXITCODE" }
  $LASTEXITCODE = 0

  # Workspace must mirror backup (remove files not present in backup).
  $wsSrc = Join-Path $src "workspace"
  if (Test-Path $wsSrc) {
    Write-Host "Mirroring workspace from backup..."
    & robocopy $wsSrc $NativeWorkspaceDir /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "workspace mirror failed code=$LASTEXITCODE" }
    $LASTEXITCODE = 0
  }

  if ((-not (Test-Path $liveEnv)) -and (Test-Path $envBak)) {
    Copy-Item -LiteralPath $envBak -Destination $liveEnv -Force
  }
  if (Test-Path $liveEnv) {
    icacls $liveEnv /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
  }

  Write-Host "Starting native gateway..."
  & (Join-Path $PSScriptRoot "start-gateway-native.ps1")
  Write-Host "Restore complete. Run .\scripts\health.ps1"
  return
}

# Docker fallback — never touch native state
if (-not (Test-Path (Join-Path $BackupDir "state"))) { throw "Invalid docker backup: missing state/ under $BackupDir" }
Write-Host "Stopping docker gateway..."
docker compose @(Get-OpenclawComposeArgs) stop openclaw-gateway 2>$null
Write-Host "Restoring Docker volumes from $BackupDir ..."
docker run --rm `
  -v aierp_openclaw_state:/state `
  -v aierp_openclaw_auth:/auth `
  -v "${BackupDir}:/in:ro" `
  alpine:3.20 `
  sh -c "rm -rf /state/* /state/.[!.]* /auth/* /auth/.[!.]* 2>/dev/null; cp -a /in/state/. /state/; cp -a /in/auth/. /auth/ 2>/dev/null || true"
if ($LASTEXITCODE -ne 0) { throw "restore failed" }
Invoke-OpenclawCompose @("up", "-d", "openclaw-gateway")
Write-Host "Restore complete. Run .\scripts\health.ps1"
