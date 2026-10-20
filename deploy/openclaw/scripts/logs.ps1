param([int]$Tail = 120)
. (Join-Path $PSScriptRoot "common.ps1")
docker logs --tail $Tail aierp-openclaw-gateway 2>&1 | ForEach-Object { Write-Redacted ("$_") }
