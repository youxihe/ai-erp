# AIERP-011: install / bootstrap isolated OpenClaw Gateway (DeepSeek + WeCom WS).
# Does not touch aierp-mysql / aierp-boot / HR containers.
param(
  [switch]$SkipPull,
  [switch]$ForceReonboard
)

. (Join-Path $PSScriptRoot "common.ps1")
Ensure-EvidenceDir

Write-Host "== AIERP OpenClaw install =="
Write-Host "Compose: $ComposeFile"
Write-Host "Env:     $EnvFile (secrets never printed)"

if (-not (Test-Path $EnvFile)) {
  throw @"
Trusted .env missing at:
  $EnvFile

Copy deploy/openclaw/.env.example -> .env and set:
  DEEPSEEK_API_KEY
  WECOM_BOT_ID
  WECOM_BOT_SECRET
  OPENCLAW_GATEWAY_TOKEN   (random long token)
Then restrict ACL to your user only, and re-run this script.
"@
}

# Restrict ACL on Windows (best-effort)
try {
  icacls $EnvFile /inheritance:r /grant:r "$env:USERNAME:(R,W)" | Out-Null
} catch {
  Write-Warning "Could not tighten ACL on .env: $_"
}

if (-not $SkipPull) {
  Write-Host "Pulling OpenClaw image..."
  $imgLine = Get-Content $EnvFile | Where-Object { $_ -match '^\s*OPENCLAW_IMAGE=' } | Select-Object -First 1
  $img = if ($imgLine) { ($imgLine -replace '^\s*OPENCLAW_IMAGE=', '').Trim() } else { "ghcr.io/openclaw/openclaw:latest" }
  docker pull $img
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "ghcr pull failed; trying Docker Hub mirror openclaw/openclaw:latest"
    docker pull openclaw/openclaw:latest
    if ($LASTEXITCODE -ne 0) { throw "Unable to pull OpenClaw image" }
    # ensure .env points to mirror if ghcr failed
    $raw = Get-Content $EnvFile -Raw
    if ($raw -notmatch 'OPENCLAW_IMAGE=') {
      Add-Content $EnvFile "`nOPENCLAW_IMAGE=openclaw/openclaw:latest"
    }
  }
}

# Create volumes + seed workspace / config via a throwaway container
Write-Host "Seeding state volume + workspace markdown..."
$seedCmd = @'
set -e
mkdir -p /home/node/.openclaw/workspace /home/node/.openclaw/backups
if [ ! -f /home/node/.openclaw/openclaw.json ] || [ "$FORCE" = "1" ]; then
  if [ -f /home/node/.openclaw/openclaw.json ]; then
    cp /home/node/.openclaw/openclaw.json "/home/node/.openclaw/backups/openclaw.json.$(date +%Y%m%d%H%M%S).bak"
  fi
  cat > /home/node/.openclaw/openclaw.json <<'JSON'
{
  "gateway": {
    "mode": "local",
    "bind": "lan",
    "auth": {
      "mode": "token",
      "token": "${OPENCLAW_GATEWAY_TOKEN}"
    },
    "controlUi": {
      "allowedOrigins": ["http://127.0.0.1:18789", "http://localhost:18789"]
    }
  },
  "agents": {
    "defaults": {
      "workspace": "/home/node/.openclaw/workspace",
      "model": {
        "primary": "deepseek/deepseek-v4-flash"
      }
    }
  },
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "${WECOM_BOT_ID}",
      "secret": "${WECOM_BOT_SECRET}",
      "dmPolicy": "pairing",
      "groupPolicy": "disabled"
    }
  },
  "tools": {
    "profile": "messaging"
  }
}
JSON
fi
chown -R node:node /home/node/.openclaw 2>/dev/null || true
chmod 700 /home/node/.openclaw 2>/dev/null || true
'@

$forceEnv = if ($ForceReonboard) { "1" } else { "0" }
$imgForSeed = "ghcr.io/openclaw/openclaw:latest"
$envImg = Get-Content $EnvFile | Where-Object { $_ -match '^\s*OPENCLAW_IMAGE=' } | Select-Object -First 1
if ($envImg) { $imgForSeed = ($envImg -replace '^\s*OPENCLAW_IMAGE=', '').Trim() }

docker volume create aierp_openclaw_state | Out-Null
docker volume create aierp_openclaw_auth | Out-Null

# Copy workspace templates into volume
docker run --rm `
  -e FORCE=$forceEnv `
  -v aierp_openclaw_state:/home/node/.openclaw `
  -v "${WorkspaceSrc}:/seed/workspace:ro" `
  --entrypoint sh `
  $imgForSeed `
  -c @"
$seedCmd
cp -a /seed/workspace/. /home/node/.openclaw/workspace/
chown -R node:node /home/node/.openclaw/workspace 2>/dev/null || true
"@
if ($LASTEXITCODE -ne 0) { throw "seed failed" }

Write-Host "Starting gateway..."
Invoke-OpenclawCompose @("up", "-d", "openclaw-gateway")

Write-Host "Waiting for health..."
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 3
  $st = docker inspect -f "{{.State.Health.Status}}" aierp-openclaw-gateway 2>$null
  if ($st -eq "healthy") { $ok = $true; break }
  $running = docker inspect -f "{{.State.Status}}" aierp-openclaw-gateway 2>$null
  if ($running -ne "running") { Write-Warning "container status=$running"; break }
}
if (-not $ok) {
  docker logs --tail 80 aierp-openclaw-gateway 2>&1 | ForEach-Object { Write-Redacted $_ }
  throw "Gateway not healthy yet; see logs above (redacted)."
}

Write-Host "Onboarding DeepSeek (non-interactive)..."
try {
  Invoke-OpenclawCompose @(
    "run", "-T", "--rm", "--no-deps", "--entrypoint", "node", "openclaw-gateway",
    "dist/index.js", "onboard",
    "--non-interactive", "--accept-risk", "--skip-health",
    "--mode", "local",
    "--auth-choice", "deepseek-api-key",
    "--secret-input-mode", "ref",
    "--gateway-auth", "token",
    "--gateway-token-ref-env", "OPENCLAW_GATEWAY_TOKEN",
    "--skip-channels",
    "--no-install-daemon"
  )
} catch {
  Write-Warning "onboard returned non-zero (may already be configured): $_"
}

Write-Host "Installing DeepSeek provider plugin..."
try {
  Invoke-OpenclawCompose @("run", "-T", "--rm", "--no-deps", "--entrypoint", "node", "openclaw-gateway",
    "dist/index.js", "plugins", "install", "@openclaw/deepseek-provider")
} catch { Write-Warning "deepseek plugin install: $_" }

Write-Host "Installing WeCom channel plugin..."
try {
  Invoke-OpenclawCompose @("run", "-T", "--rm", "--no-deps", "--entrypoint", "node", "openclaw-gateway",
    "dist/index.js", "plugins", "install", "@wecom/wecom-openclaw-plugin")
} catch {
  Write-Warning "plugins install wecom failed, trying channels add..."
  try {
    Invoke-OpenclawCompose @("run", "-T", "--rm", "--no-deps", "--entrypoint", "node", "openclaw-gateway",
      "dist/index.js", "channels", "add", "--channel", "wecom")
  } catch { Write-Warning "channels add wecom: $_" }
}

Write-Host "Applying WeCom + model config via CLI..."
$configCmds = @(
  @("config", "set", "agents.defaults.model.primary", "deepseek/deepseek-v4-flash"),
  @("config", "set", "channels.wecom.enabled", "true"),
  @("config", "set", "channels.wecom.connectionMode", "websocket"),
  @("config", "set", "channels.wecom.dmPolicy", "pairing"),
  @("config", "set", "channels.wecom.groupPolicy", "disabled"),
  @("config", "set", "tools.profile", "messaging"),
  @("config", "set", "gateway.bind", "lan")
)
foreach ($c in $configCmds) {
  try {
    Invoke-OpenclawCompose @("run", "-T", "--rm", "--no-deps", "--entrypoint", "node", "openclaw-gateway",
      (@("dist/index.js") + $c))
  } catch { Write-Warning ("config set failed: " + ($c -join ' ')) }
}

# Prefer env refs for secrets if CLI supports; also write botId/secret from env into config as ${VAR} if needed.
# Recreate gateway to pick up plugins + env
Invoke-OpenclawCompose @("up", "-d", "--force-recreate", "openclaw-gateway")
Start-Sleep -Seconds 8

Write-Host "Doctor / status (redacted)..."
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$report = Join-Path $EvidenceDir "install-$stamp.txt"
$buf = New-Object System.Text.StringBuilder
[void]$buf.AppendLine("installedAt=$stamp")
[void]$buf.AppendLine("image=$(docker inspect -f '{{.Config.Image}}' aierp-openclaw-gateway)")
[void]$buf.AppendLine("health=$(docker inspect -f '{{.State.Health.Status}}' aierp-openclaw-gateway)")
[void]$buf.AppendLine("ui=http://127.0.0.1:18789/")
[void]$buf.AppendLine("--- doctor ---")
try {
  $doc = & docker compose @(Get-OpenclawComposeArgs) run -T --rm --no-deps --entrypoint node openclaw-gateway dist/index.js doctor --non-interactive 2>&1 | Out-String
  [void]$buf.AppendLine((Write-Redacted $doc))
} catch { [void]$buf.AppendLine("doctor error (redacted)") }

Set-Content -Path $report -Value $buf.ToString() -Encoding UTF8
Write-Host "Wrote redacted report: $report"
Write-Host "DONE. Open http://127.0.0.1:18789/ and paste OPENCLAW_GATEWAY_TOKEN from .env (not logged here)."
Write-Host "Next: .\scripts\health.ps1 then test WeCom DM '你好'."
