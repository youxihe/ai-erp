param(
  [int]$Tail = 120,
  [ValidateSet("auto", "native", "docker")][string]$Mode = "auto"
)
. (Join-Path $PSScriptRoot "common.ps1")
$runtime = Get-OpenclawRuntimeMode -Mode $Mode
Write-Host "== OpenClaw logs (runtime=$runtime tail=$Tail) =="

if ($runtime -eq "native") {
  Ensure-EvidenceDir
  $log = Join-Path $EvidenceDir "gateway-run.log"
  $err = Join-Path $EvidenceDir "gateway-run.err.log"
  foreach ($f in @($log, $err)) {
    if (-not (Test-Path $f)) {
      Write-Host "(missing $f)"
      continue
    }
    Write-Host "--- $(Split-Path $f -Leaf) ---"
    Get-Content -LiteralPath $f -Tail $Tail -ErrorAction SilentlyContinue |
      ForEach-Object { Write-Redacted ("$_") }
  }
  return
}

docker logs --tail $Tail aierp-openclaw-gateway 2>&1 | ForEach-Object { Write-Redacted ("$_") }
