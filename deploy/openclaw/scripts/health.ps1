param(
  [ValidateSet("auto", "native", "docker")][string]$Mode = "auto"
)
. (Join-Path $PSScriptRoot "common.ps1")
Ensure-EvidenceDir
$runtime = Get-OpenclawRuntimeMode -Mode $Mode
Write-Host "== OpenClaw health (runtime=$runtime) =="
Write-Host "ui=http://127.0.0.1:$NativeGatewayPort/"

if ($runtime -eq "native") {
  Write-Host "native_prefix=$NativePrefix"
  Write-Host "native_state=$NativeStateDir"
  $owned = @(Get-OwnedNativeGatewayPids)
  if ($owned.Count -eq 0) {
    Write-Host "gateway_pid=none"
  } else {
    foreach ($procId in $owned) {
      $cmd = Write-Redacted (Get-ProcessCommandLine -ProcessId $procId)
      $leak = Test-GatewayCommandLineHasToken -ProcessId $procId
      Write-Host "gateway_pid=$procId cmdline_token_leak=$leak"
      Write-Host "cmdline=$cmd"
    }
  }
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$NativeGatewayPort/" -UseBasicParsing -TimeoutSec 5
    Write-Host "http_status=$($r.StatusCode)"
  } catch {
    Write-Host "http_status=FAIL $(Write-Redacted $_.Exception.Message)"
  }

  Write-Host "--- doctor ---"
  try {
    Invoke-NativeOpenclawCli doctor --non-interactive 2>&1 | ForEach-Object { Write-Redacted ("$_") }
  } catch { Write-Warning (Write-Redacted "$_") }

  Write-Host "--- models (deepseek) ---"
  try {
    Invoke-NativeOpenclawCli models list --provider deepseek 2>&1 | ForEach-Object { Write-Redacted ("$_") }
  } catch { Write-Warning (Write-Redacted "$_") }

  Write-Host "--- channels status --probe ---"
  try {
    Invoke-NativeOpenclawCli channels status --probe 2>&1 | ForEach-Object { Write-Redacted ("$_") }
  } catch {
    try {
      Invoke-NativeOpenclawCli channels status --channel wecom 2>&1 | ForEach-Object { Write-Redacted ("$_") }
    } catch { Write-Warning (Write-Redacted "$_") }
  }
  return
}

# Docker fallback (optional / not currently active on this host)
Write-Host "NOTE: Docker path is optional fallback; native is the active deployment."
docker compose @(Get-OpenclawComposeArgs) ps
$health = docker inspect -f "{{.State.Health.Status}}" aierp-openclaw-gateway 2>$null
$image = docker inspect -f "{{.Config.Image}}" aierp-openclaw-gateway 2>$null
Write-Host "health=$health image=$image"
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$NativeGatewayPort/" -UseBasicParsing -TimeoutSec 5
  Write-Host "http_status=$($r.StatusCode)"
} catch {
  Write-Host "http_status=FAIL $(Write-Redacted $_.Exception.Message)"
}
Write-Host "--- doctor ---"
try {
  docker compose @(Get-OpenclawComposeArgs) run -T --rm --no-deps --entrypoint node openclaw-gateway dist/index.js doctor --non-interactive 2>&1 |
    ForEach-Object { Write-Redacted ("$_") }
} catch { Write-Warning $_ }
Write-Host "--- channels status --probe ---"
try {
  docker compose @(Get-OpenclawComposeArgs) run -T --rm --no-deps --entrypoint node openclaw-gateway dist/index.js channels status --probe 2>&1 |
    ForEach-Object { Write-Redacted ("$_") }
} catch { Write-Warning $_ }
