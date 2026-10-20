. (Join-Path $PSScriptRoot "common.ps1")
Write-Host "Backup before upgrade..."
& (Join-Path $PSScriptRoot "backup.ps1")

$imgLine = Get-Content $EnvFile | Where-Object { $_ -match '^\s*OPENCLAW_IMAGE=' } | Select-Object -First 1
$img = if ($imgLine) { ($imgLine -replace '^\s*OPENCLAW_IMAGE=', '').Trim() } else { "ghcr.io/openclaw/openclaw:latest" }
Write-Host "Pulling $img ..."
docker pull $img
if ($LASTEXITCODE -ne 0) { throw "pull failed" }

Write-Host "Recreating gateway..."
Invoke-OpenclawCompose @("up", "-d", "--force-recreate", "openclaw-gateway")
Start-Sleep -Seconds 10
& (Join-Path $PSScriptRoot "health.ps1")
Write-Host "If health fails, restore latest folder under deploy/openclaw/state/backup-* via restore.ps1"
