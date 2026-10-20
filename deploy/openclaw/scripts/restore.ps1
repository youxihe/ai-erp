param(
  [Parameter(Mandatory = $true)][string]$BackupDir
)
. (Join-Path $PSScriptRoot "common.ps1")
$BackupDir = (Resolve-Path $BackupDir).Path
if (-not (Test-Path (Join-Path $BackupDir "state"))) { throw "Invalid backup: missing state/ under $BackupDir" }

Write-Host "Stopping gateway..."
docker compose @(Get-OpenclawComposeArgs) stop openclaw-gateway 2>$null

Write-Host "Restoring volumes from $BackupDir ..."
docker run --rm `
  -v aierp_openclaw_state:/state `
  -v aierp_openclaw_auth:/auth `
  -v "${BackupDir}:/in:ro" `
  alpine:3.20 `
  sh -c "rm -rf /state/* /state/.[!.]* /auth/* /auth/.[!.]* 2>/dev/null; cp -a /in/state/. /state/; cp -a /in/auth/. /auth/ 2>/dev/null || true"
if ($LASTEXITCODE -ne 0) { throw "restore failed" }

Invoke-OpenclawCompose @("up", "-d", "openclaw-gateway")
Write-Host "Restore complete. Run .\scripts\health.ps1"
