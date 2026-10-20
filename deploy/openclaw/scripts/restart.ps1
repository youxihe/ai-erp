. (Join-Path $PSScriptRoot "common.ps1")
Write-Host "Recreating gateway (applies .env changes)..."
Invoke-OpenclawCompose @("up", "-d", "--force-recreate", "openclaw-gateway")
Start-Sleep -Seconds 5
& (Join-Path $PSScriptRoot "health.ps1")
