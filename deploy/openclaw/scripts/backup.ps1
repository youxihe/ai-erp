. (Join-Path $PSScriptRoot "common.ps1")
Ensure-EvidenceDir
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$out = Join-Path $OpenclawRoot "state\backup-$stamp"
New-Item -ItemType Directory -Force -Path $out | Out-Null

Write-Host "Backing up Docker volumes to $out (no .env secrets copied)..."
docker run --rm `
  -v aierp_openclaw_state:/state:ro `
  -v aierp_openclaw_auth:/auth:ro `
  -v "${out}:/out" `
  alpine:3.20 `
  sh -c "mkdir -p /out/state /out/auth && cp -a /state/. /out/state/ && cp -a /auth/. /out/auth/ && find /out -type f -name '.env' -delete"
if ($LASTEXITCODE -ne 0) { throw "backup failed" }

# Strip obvious secret-looking JSON string values from a redacted config snapshot
$cfg = Join-Path $out "state\openclaw.json"
if (Test-Path $cfg) {
  $red = Write-Redacted (Get-Content $cfg -Raw)
  Set-Content -Path (Join-Path $out "openclaw.redacted.json") -Value $red -Encoding UTF8
}

Write-Host "Backup OK: $out"
Write-Host "NOTE: .env remains only at $EnvFile — back it up yourself to a private vault if needed."
