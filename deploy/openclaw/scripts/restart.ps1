param(
  [ValidateSet("auto", "native", "docker")][string]$Mode = "auto"
)
. (Join-Path $PSScriptRoot "common.ps1")
$runtime = Get-OpenclawRuntimeMode -Mode $Mode
Write-Host "== OpenClaw restart (runtime=$runtime) =="

if ($runtime -eq "native") {
  Assert-GatewayPortSafeToBind
  & (Join-Path $PSScriptRoot "start-gateway-native.ps1")
  Start-Sleep -Seconds 3
  & (Join-Path $PSScriptRoot "health.ps1") -Mode native
  return
}

Write-Host "Recreating docker gateway (optional fallback)..."
Invoke-OpenclawCompose @("up", "-d", "--force-recreate", "openclaw-gateway")
Start-Sleep -Seconds 5
& (Join-Path $PSScriptRoot "health.ps1") -Mode docker
