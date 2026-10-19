# Start AI-ERP isolated MySQL + Redis (does not touch other projects).
$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not (Test-Path (Join-Path $Root "deploy\docker-compose.yml"))) {
  $Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
}
$Deploy = Join-Path $Root "deploy"
Set-Location $Deploy

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created deploy/.env from .env.example — review passwords before production use."
}

docker compose --env-file .env -f docker-compose.yml up -d aierp-mysql aierp-redis
docker compose -f docker-compose.yml ps
Write-Host "MySQL: 127.0.0.1:13306  Redis: 127.0.0.1:16379"
