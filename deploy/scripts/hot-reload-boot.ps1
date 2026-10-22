# Hot-reload aierp-boot Java without rebuilding the Docker image.
# Compiles jshERP with maven container → deploy/runtime/app.jar → restart boot.
#
# Safety:
#   - Only one agent replaces the runtime jar at a time (deploy/runtime/.hot-reload.lock)
#   - Build writes app.jar.building first; failed compile never overwrites a good jar
#   - Previous jar kept as app.jar.bak; start failure restores backup automatically
#
# Usage (from repo root or deploy/):
#   powershell -File deploy/scripts/hot-reload-boot.ps1
#   powershell -File deploy/scripts/hot-reload-boot.ps1 -SkipCompile   # remount/restart existing jar
#
# Manual rollback if needed:
#   Copy-Item deploy\runtime\app.jar.bak deploy\runtime\app.jar -Force
#   docker compose --env-file deploy/.env -f deploy/docker-compose.yml -f deploy/docker-compose.boot-hot.yml up -d aierp-boot
#
# First image build still needed once (fonts/JRE). After that, prefer this script.

param(
  [switch]$SkipCompile,
  [string]$RepoRoot = "",
  [int]$LockTimeoutSec = 1800,
  [int]$HealthWaitSec = 120
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepoRoot = (Resolve-Path (Join-Path $here "..\..")).Path
}

$deploy = Join-Path $RepoRoot "deploy"
$runtimeDir = Join-Path $deploy "runtime"
$jarOut = Join-Path $runtimeDir "app.jar"
$jarBak = Join-Path $runtimeDir "app.jar.bak"
$tmpJar = Join-Path $runtimeDir "app.jar.building"
$lockFile = Join-Path $runtimeDir ".hot-reload.lock"
$compose = Join-Path $deploy "docker-compose.yml"
$composeHot = Join-Path $deploy "docker-compose.boot-hot.yml"
$envFile = Join-Path $deploy ".env"
$bootSrc = Join-Path $RepoRoot "jshERP-boot"

function Test-BootHttp {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:9999/jshERP-boot/doc.html" -UseBasicParsing -TimeoutSec 3
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Wait-BootHttp {
  param([int]$TimeoutSec = 120)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-BootHttp) { return $true }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Invoke-BootComposeUp {
  Push-Location $deploy
  try {
    # The bind-mounted app.jar changes without changing Compose configuration.
    # Plain "up -d" may leave the existing JVM running OLD bytecode.
    docker compose --env-file .env -f docker-compose.yml -f docker-compose.boot-hot.yml config -q
    if ($LASTEXITCODE -ne 0) { throw "compose overlay config invalid (exit $LASTEXITCODE)" }
    docker compose --env-file .env -f docker-compose.yml -f docker-compose.boot-hot.yml up -d --force-recreate --no-deps aierp-boot
    if ($LASTEXITCODE -ne 0) { throw "docker compose recreate aierp-boot failed (exit $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
}

function Test-BootJarMatchesHost {
  if (-not (Test-Path $jarOut)) { return $false }
  try {
    $expected = (Get-FileHash -Path $jarOut -Algorithm SHA256).Hash.ToLowerInvariant()
    $lines = @(docker exec aierp-boot sha256sum /app/app.jar 2>&1)
    if ($LASTEXITCODE -ne 0 -or $lines.Count -eq 0) { return $false }
    $actual = ([string]$lines[0] -split '\s+')[0].Trim().ToLowerInvariant()
    return ($actual -eq $expected)
  } catch {
    return $false
  }
}

function Acquire-HotReloadLock {
  param([string]$Path, [int]$TimeoutSec)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ($true) {
    $stale = $false
    if (Test-Path $Path) {
      try {
        $meta = Get-Content $Path -Raw -ErrorAction Stop | ConvertFrom-Json
        $age = ((Get-Date).ToUniversalTime() - [datetime]::Parse($meta.acquiredAtUtc, $null, [System.Globalization.DateTimeStyles]::RoundtripKind)).TotalSeconds
        if ($age -gt $TimeoutSec) {
          Write-Host "stale lock (age ${age}s > ${TimeoutSec}s) — taking over"
          $stale = $true
        } else {
          $remaining = [math]::Max(1, [int]($TimeoutSec - $age))
          Write-Host "hot-reload locked by pid=$($meta.pid) since $($meta.acquiredAtUtc); wait ${remaining}s or remove $Path"
          if ((Get-Date) -ge $deadline) {
            throw "timed out waiting for hot-reload lock: $Path"
          }
          Start-Sleep -Seconds ([math]::Min(5, $remaining))
          continue
        }
      } catch {
        if ($_.Exception.Message -like "timed out waiting*") { throw }
        # Unreadable lock → treat as stale
        $stale = $true
      }
    }
    $payload = @{
      pid = $PID
      acquiredAtUtc = (Get-Date).ToUniversalTime().ToString("o")
      host = $env:COMPUTERNAME
    } | ConvertTo-Json -Compress
    try {
      if ($stale -or -not (Test-Path $Path)) {
        # New file only when absent; stale overwrite is intentional takeover
        if ($stale) {
          Set-Content -Path $Path -Value $payload -Encoding utf8
        } else {
          $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
          try {
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
            $fs.Write($bytes, 0, $bytes.Length)
          } finally {
            $fs.Dispose()
          }
        }
        return
      }
    } catch [System.IO.IOException] {
      Start-Sleep -Seconds 2
      if ((Get-Date) -ge $deadline) {
        throw "timed out waiting for hot-reload lock: $Path"
      }
    }
  }
}

function Release-HotReloadLock {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }
  try {
    $meta = Get-Content $Path -Raw -ErrorAction Stop | ConvertFrom-Json
    if ([int]$meta.pid -eq $PID) {
      Remove-Item $Path -Force -ErrorAction Stop
    }
  } catch {
    # Best-effort; do not fail the script on lock cleanup
  }
}

if (-not (Test-Path $compose)) { throw "missing $compose" }
if (-not (Test-Path $composeHot)) { throw "missing $composeHot" }
if (-not (Test-Path $envFile)) { throw "missing $envFile — copy deploy/.env.example first" }
if (-not (Test-Path $bootSrc)) { throw "missing $bootSrc" }

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Acquire-HotReloadLock -Path $lockFile -TimeoutSec $LockTimeoutSec

try {
  $hadPreviousJar = Test-Path $jarOut

  if (-not $SkipCompile) {
    Write-Host "== mvn package (docker maven:3.9.6-eclipse-temurin-8) =="
    $m2 = Join-Path $deploy ".m2-repo"
    New-Item -ItemType Directory -Force -Path $m2 | Out-Null
    Remove-Item $tmpJar -Force -ErrorAction SilentlyContinue

    docker run --rm `
      -v "${bootSrc}:/src" `
      -v "${m2}:/root/.m2" `
      -v "${runtimeDir}:/out" `
      -w /src `
      maven:3.9.6-eclipse-temurin-8 `
      bash -lc "mvn -B -DskipTests -Dmaven.compiler.skip=false package && test -f target/jshERP.jar && cp target/jshERP.jar /out/app.jar.building"

    if ($LASTEXITCODE -ne 0) {
      Remove-Item $tmpJar -Force -ErrorAction SilentlyContinue
      throw "maven compile failed (exit $LASTEXITCODE) — left existing app.jar untouched"
    }
    if (-not (Test-Path $tmpJar)) {
      throw "compile produced no jar — left existing app.jar untouched"
    }

    # Backup good jar before swap so start failure can roll back
    if ($hadPreviousJar) {
      Copy-Item -Force $jarOut $jarBak
      Write-Host "backup: $jarBak ($((Get-Item $jarBak).Length) bytes)"
    }

    Move-Item -Force $tmpJar $jarOut
    $bytes = (Get-Item $jarOut).Length
    Write-Host "jar ready: $jarOut ($bytes bytes)"
  } else {
    if (-not (Test-Path $jarOut)) {
      Write-Host "== seed jar from running aierp-boot image =="
      docker cp "aierp-boot:/app/app.jar" $jarOut
    }
    if (-not (Test-Path $jarOut)) { throw "no $jarOut — run without -SkipCompile once" }
    Write-Host "using existing $jarOut ($((Get-Item $jarOut).Length) bytes)"
  }

  Write-Host "== recreate aierp-boot with jar bind-mount =="
  Invoke-BootComposeUp

  Write-Host "== wait HTTP (doc.html) =="
  $httpOk = Wait-BootHttp -TimeoutSec $HealthWaitSec
  $hashOk = $httpOk -and (Test-BootJarMatchesHost)
  if ($httpOk -and $hashOk) {
    Write-Host "bootReady=true doc.html=200 jarSha256Matched=true"
  } else {
    Write-Host "bootReady=false httpOk=$httpOk jarSha256Matched=$hashOk — attempting rollback from app.jar.bak"
    docker logs aierp-boot --tail 30 2>&1 | Select-Object -Last 30
    if (Test-Path $jarBak) {
      Copy-Item -Force $jarBak $jarOut
      Write-Host "restored $jarOut from $jarBak"
      Invoke-BootComposeUp
      $rolled = Wait-BootHttp -TimeoutSec $HealthWaitSec
      $rolledHashOk = $rolled -and (Test-BootJarMatchesHost)
      if ($rolled -and $rolledHashOk) {
        Write-Host "rollbackReady=true doc.html=200 jarSha256Matched=true (previous jar restored)"
      } else {
        Write-Host "rollbackReady=false httpOk=$rolled jarSha256Matched=$rolledHashOk — check: docker logs aierp-boot --tail 50"
        throw "hot-reload start failed; backup restore also failed health check"
      }
      throw "hot-reload start failed; restored previous jar from app.jar.bak"
    } else {
      throw "hot-reload start failed and no app.jar.bak available to restore"
    }
  }

  Write-Host "Done. Next Java edit → re-run this script (no image rebuild)."
} finally {
  Release-HotReloadLock -Path $lockFile
}
