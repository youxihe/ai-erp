$ErrorActionPreference = "Stop"
$Deploy = Split-Path $PSScriptRoot -Parent
Set-Location $Deploy
docker compose -f docker-compose.yml down
Write-Host "AI-ERP containers stopped (volumes kept). Use 'docker compose down -v' to wipe data."
