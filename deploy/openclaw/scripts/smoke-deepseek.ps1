# One real DeepSeek completion via OpenClaw CLI (no secrets printed).
. (Join-Path $PSScriptRoot "common.ps1")
Ensure-EvidenceDir
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$out = Join-Path $EvidenceDir "deepseek-smoke-$stamp.txt"

Write-Host "Running DeepSeek smoke (model deepseek/deepseek-v4-flash)..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$raw = ""
try {
  $raw = & docker compose @(Get-OpenclawComposeArgs) run -T --rm --no-deps --entrypoint node openclaw-gateway `
    dist/index.js agent --message "Reply with exactly: AIERP-011-OK" --model deepseek/deepseek-v4-flash 2>&1 | Out-String
} catch {
  # fallbacks for CLI shape differences
  try {
    $raw = & docker compose @(Get-OpenclawComposeArgs) run -T --rm --no-deps --entrypoint node openclaw-gateway `
      dist/index.js models status --provider deepseek 2>&1 | Out-String
  } catch {
    $raw = "$_"
  }
}
$sw.Stop()
$red = Write-Redacted $raw
@"
elapsedMs=$($sw.ElapsedMilliseconds)
model=deepseek/deepseek-v4-flash
output=
$red
"@ | Set-Content -Path $out -Encoding UTF8

Write-Host "elapsedMs=$($sw.ElapsedMilliseconds)"
Write-Host "report=$out"
if ($red -match 'AIERP-011-OK' -or $red -match 'deepseek') {
  Write-Host "SMOKE_HINT=see report (look for model reply or provider listing)"
} else {
  Write-Host "SMOKE_HINT=CLI shape may differ; check report and Control UI chat"
}
