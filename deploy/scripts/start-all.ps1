# Start AI-ERP isolated stack: MySQL + Redis + Boot (+ optional web hint)
$ErrorActionPreference = "Stop"
$Deploy = Split-Path $PSScriptRoot -Parent
$Root = Split-Path $Deploy -Parent
Set-Location $Deploy

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created deploy/.env from example."
}

Write-Host "==> Starting MySQL / Redis / Boot"
docker compose --env-file .env -f docker-compose.yml up -d --build
docker compose --env-file .env -f docker-compose.yml ps

Write-Host "==> Applying PCB demo master data (idempotent)"
& "$PSScriptRoot\seed-demo.ps1"

Write-Host ""
Write-Host "Backend API:  http://127.0.0.1:9999/jshERP-boot/doc.html"
Write-Host "Frontend:     cd jshERP-web && npm run serve  -> http://localhost:3000/"
Write-Host "Login:        jsh / 123456  (or admin / 123456)"
Write-Host "MySQL:        127.0.0.1:13306  Redis: 127.0.0.1:16379"
Write-Host "Baseline:     node deploy/scripts/baseline-flow.mjs"
