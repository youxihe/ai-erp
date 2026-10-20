param(
  [ValidateSet("auto", "native", "docker")][string]$Mode = "auto",
  # Full consistent backup (briefly stops owned native gateway). Default = live copy without sqlite.
  [switch]$Consistent
)
. (Join-Path $PSScriptRoot "common.ps1")
Ensure-EvidenceDir
$runtime = Get-OpenclawRuntimeMode -Mode $Mode
Write-Host "== OpenClaw backup (runtime=$runtime) =="
Write-Host "backup_root=$NativeBackupRoot"

if ($runtime -eq "native") {
  if ($Consistent) {
    $out = Backup-NativeOpenclawState -Consistent
    Write-Host "Restarting gateway after consistent backup..."
    & (Join-Path $PSScriptRoot "start-gateway-native.ps1")
  } else {
    $out = Backup-NativeOpenclawState
  }
  $cfgInBackup = Join-Path $out "openclaw.json"
  if (Test-Path $cfgInBackup) {
    $red = Write-Redacted (Get-Content -LiteralPath $cfgInBackup -Raw)
    Set-Content -Path (Join-Path $out "openclaw.redacted.json") -Value $red -Encoding UTF8
  }
  Write-Host "DONE=$out"
  return
}

$stamp = Get-Date -Format "yyyyMMddHHmmss"
$out = Join-Path $OpenclawRoot "state\backup-$stamp"
New-Item -ItemType Directory -Force -Path $out | Out-Null
Write-Host "Backing up Docker volumes to $out (optional fallback path)..."
docker run --rm `
  -v aierp_openclaw_state:/state:ro `
  -v aierp_openclaw_auth:/auth:ro `
  -v "${out}:/out" `
  alpine:3.20 `
  sh -c "mkdir -p /out/state /out/auth && cp -a /state/. /out/state/ && cp -a /auth/. /out/auth/ && find /out -type f -name '.env' -delete"
if ($LASTEXITCODE -ne 0) { throw "backup failed" }
Write-Host "Backup OK: $out"
Write-Host "NOTE: .env remains only at $EnvFile — back it up yourself to a private vault if needed."
