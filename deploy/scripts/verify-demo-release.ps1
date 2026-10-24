# Read-only release fingerprint check for Windows local AI ERP Demo.
# Does not rebuild/restart services or modify stock, data or configuration.
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$StateDir = "F:\aierp-openclaw\state",
  [string]$BootContainer = "aierp-boot",
  [string]$BootHealthUrl = "http://127.0.0.1:9999/doc.html",
  [string]$GatewayHealthUrl = "http://127.0.0.1:18789/health"
)

$ErrorActionPreference = "Stop"
$checks = @()
function Add-Check($name, $pass, $detail, $blocking = $true) {
  $script:checks += [ordered]@{ name=$name; pass=[bool]$pass; blocking=[bool]$blocking; detail=[string]$detail }
}

Push-Location $RepoRoot
try {
  $head = (& git rev-parse HEAD 2>&1 | Select-Object -First 1)
  $headExit = $LASTEXITCODE
  $branch = (& git rev-parse --abbrev-ref HEAD 2>&1 | Select-Object -First 1)
  Add-Check "local_git_head" ($headExit -eq 0) "$branch @ $head"
  $originHead = $null
  $rem = @(& git ls-remote origin refs/heads/master 2>&1)
  if ($LASTEXITCODE -eq 0 -and $rem.Count -gt 0) {
    $originHead = ([string]$rem[0] -split "\s+")[0]
  }
  Add-Check "origin_master_verified" ([bool]$originHead) ("origin/master=" + $originHead)
  if ($originHead) {
    Add-Check "checkout_is_origin_master" ($head -eq $originHead) "repo=$head origin=$originHead"
  }
} finally { Pop-Location }

$hostJar = Join-Path $RepoRoot "deploy\runtime\app.jar"
$jarHash = $null
if (Test-Path $hostJar) {
  $jarHash = (Get-FileHash $hostJar -Algorithm SHA256).Hash.ToLowerInvariant()
}
Add-Check "host_jar_exists" ([bool]$jarHash) "deploy/runtime/app.jar"
$insideHash = $null
try {
  $out = @(& docker exec $BootContainer sha256sum /app/app.jar 2>&1)
  if ($LASTEXITCODE -eq 0 -and $out.Count -gt 0) {
    $insideHash = ([string]$out[0] -split "\s+")[0].ToLowerInvariant()
  }
} catch { }
Add-Check "container_jar_sha_matches" ([bool]$jarHash -and ($jarHash -eq $insideHash)) ("host=$jarHash container=$insideHash")

$src = Join-Path $RepoRoot "deploy\openclaw\plugins\aierp-erp-tools"
$dst = Join-Path $StateDir "extensions\aierp-erp-tools"
$required = @(
  "index.js", "openclaw.plugin.json",
  "sop\registry.mjs", "sop\receipt-send.mjs",
  "sop\purchase-batch-prepare.mjs", "sop\mix-prepare.mjs",
  "sop\register-mix-confirm.mjs", "sop\service-consume.mjs",
  "sop\renderers\wecom-business.mjs"
)
$diffs = @()
foreach ($rel in $required) {
  $a = Join-Path $src $rel
  $b = Join-Path $dst $rel
  if (-not (Test-Path $a) -or -not (Test-Path $b)) { $diffs += "$rel missing"; continue }
  $x = (Get-FileHash $a -Algorithm SHA256).Hash
  $y = (Get-FileHash $b -Algorithm SHA256).Hash
  if ($x -ne $y) { $diffs += "$rel sha mismatch" }
}
Add-Check "live_f_plugin_matches_checkout" ($diffs.Count -eq 0) (($diffs -join "; ") + " (checked=$($required.Count))")

foreach ($probe in @(@("erp_doc", $BootHealthUrl), @("openclaw_health", $GatewayHealthUrl))) {
  $pass = $false
  $detail = ""
  try {
    $res = Invoke-WebRequest -Uri $probe[1] -Method Get -TimeoutSec 6 -UseBasicParsing
    $pass = ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300)
    $detail = "HTTP $($res.StatusCode)"
  } catch { $detail = $_.Exception.Message }
  Add-Check $probe[0] $pass $detail
}

$allPass = @($checks | Where-Object { $_.blocking -and -not $_.pass }).Count -eq 0
[ordered]@{
  overall = $(if ($allPass) { "SOURCE_AND_ARTIFACT_CHECKS_PASS" } else { "NOT_VERIFIED" })
  note = "This checks hashes and health only; NOT actual SDK tool registration, all DB migrations, or human WeCom chat UAT."
  localGitHead = $head
  originMasterHead = $originHead
  hostJarSha256 = $jarHash
  containerJarSha256 = $insideHash
  pluginPath = $dst
  checks = $checks
} | ConvertTo-Json -Depth 6
if (-not $allPass) { exit 2 }
