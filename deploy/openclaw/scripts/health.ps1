. (Join-Path $PSScriptRoot "common.ps1")
Ensure-EvidenceDir

Write-Host "== OpenClaw health =="
docker compose @(Get-OpenclawComposeArgs) ps
$health = docker inspect -f "{{.State.Health.Status}}" aierp-openclaw-gateway 2>$null
$image = docker inspect -f "{{.Config.Image}}" aierp-openclaw-gateway 2>$null
Write-Host "health=$health image=$image"
Write-Host "ui=http://127.0.0.1:18789/"

try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:18789/" -UseBasicParsing -TimeoutSec 5
  Write-Host "http_status=$($r.StatusCode)"
} catch {
  Write-Host "http_status=FAIL $($_.Exception.Message)"
}

Write-Host "--- doctor ---"
try {
  docker compose @(Get-OpenclawComposeArgs) run -T --rm --no-deps --entrypoint node openclaw-gateway dist/index.js doctor --non-interactive 2>&1 |
    ForEach-Object { Write-Redacted ("$_") }
} catch { Write-Warning $_ }

Write-Host "--- models (deepseek) ---"
try {
  docker compose @(Get-OpenclawComposeArgs) run -T --rm --no-deps --entrypoint node openclaw-gateway dist/index.js models list --provider deepseek 2>&1 |
    ForEach-Object { Write-Redacted ("$_") }
} catch { Write-Warning $_ }

Write-Host "--- channels status --probe ---"
try {
  docker compose @(Get-OpenclawComposeArgs) run -T --rm --no-deps --entrypoint node openclaw-gateway dist/index.js channels status --probe 2>&1 |
    ForEach-Object { Write-Redacted ("$_") }
} catch {
  try {
    docker compose @(Get-OpenclawComposeArgs) run -T --rm --no-deps --entrypoint node openclaw-gateway dist/index.js channels status --channel wecom 2>&1 |
      ForEach-Object { Write-Redacted ("$_") }
  } catch { Write-Warning $_ }
}
