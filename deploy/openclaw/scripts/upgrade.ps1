param(
  [ValidateSet("auto", "native", "docker")][string]$Mode = "auto",
  # Native upgrades require an explicit version pin (no silent @latest).
  [string]$NativeVersion = ""
)
. (Join-Path $PSScriptRoot "common.ps1")
$runtime = Get-OpenclawRuntimeMode -Mode $Mode
Write-Host "== OpenClaw upgrade (runtime=$runtime) =="

if ($runtime -eq "native") {
  if ([string]::IsNullOrWhiteSpace($NativeVersion)) {
    Write-Host "REFUSED: native upgrade requires -NativeVersion <semver> (e.g. 2026.10.5)."
    Write-Host "Current CLI:"
    try { Invoke-NativeOpenclawCli --version 2>&1 | ForEach-Object { Write-Redacted ("$_") } } catch { }
    Write-Host "Example: .\scripts\upgrade.ps1 -NativeVersion 2026.10.5"
    Write-Host "This will: backup state → npm install openclaw@<version> → restart owned gateway."
    exit 2
  }

  $bak = Backup-NativeOpenclawState -Label "pre-upgrade"
  $verFile = Join-Path $bak "pre-upgrade-version.txt"
  try {
    $ver = & $NativeCli --version 2>&1 | Out-String
    Set-Content -LiteralPath $verFile -Value (Write-Redacted $ver) -Encoding UTF8
  } catch {
    Set-Content -LiteralPath $verFile -Value "version-unknown" -Encoding UTF8
  }
  Write-Host "Pinned upgrade target: openclaw@$NativeVersion"
  Write-Host "Pre-upgrade backup: $bak"

  Import-NativeOpenclawEnv
  Push-Location $NativePrefix
  try {
    npm install "openclaw@$NativeVersion" --allow-scripts=openclaw
    if ($LASTEXITCODE -ne 0) { throw "npm install openclaw@$NativeVersion failed" }
  } finally {
    Pop-Location
  }

  & (Join-Path $PSScriptRoot "start-gateway-native.ps1")
  Start-Sleep -Seconds 3
  & (Join-Path $PSScriptRoot "health.ps1") -Mode native
  Write-Host "If health fails, restore: .\scripts\restore.ps1 -BackupDir `"$bak`""
  return
}

Write-Host "Backup before docker upgrade..."
& (Join-Path $PSScriptRoot "backup.ps1") -Mode docker
$imgLine = Get-Content $EnvFile | Where-Object { $_ -match '^\s*OPENCLAW_IMAGE=' } | Select-Object -First 1
$img = if ($imgLine) { ($imgLine -replace '^\s*OPENCLAW_IMAGE=', '').Trim() } else { "ghcr.io/openclaw/openclaw:2026.10.5" }
if ($img -match ':latest$') {
  Write-Warning "OPENCLAW_IMAGE uses :latest — prefer a pinned tag before production upgrades."
}
Write-Host "Pulling $img ..."
docker pull $img
if ($LASTEXITCODE -ne 0) { throw "pull failed" }
Invoke-OpenclawCompose @("up", "-d", "--force-recreate", "openclaw-gateway")
Start-Sleep -Seconds 10
& (Join-Path $PSScriptRoot "health.ps1") -Mode docker
