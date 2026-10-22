# Seed PCB demo master data into the isolated aierp-mysql database.
# Refuses to run unless this is the upstream jshERP demo tenant (id=63 / login jsh).
$ErrorActionPreference = "Stop"
$Deploy = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $Deploy ".env"
$rootPwd = "aierp_root_change_me"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*AIERP_MYSQL_ROOT_PASSWORD=(.+)$') { $rootPwd = $Matches[1].Trim() }
  }
}

function Invoke-AierpSql([string]$Sql) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = docker exec aierp-mysql mysql -uroot "-p$rootPwd" -N --default-character-set=utf8mb4 jsh_erp -e $Sql 2>&1 |
    ForEach-Object { "$_" } |
    Where-Object { $_ -notmatch 'Using a password on the command line' }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  $text = ($out | Out-String).Trim()
  if ($code -ne 0) { throw "MySQL check failed: $text" }
  return $text
}

$identity = Invoke-AierpSql "SELECT CONCAT(id,'|',login_name,'|',IFNULL(tenant_id,'null')) FROM jsh_user WHERE id=63 AND IFNULL(delete_flag,'0')<>'1';"
if ($identity -ne '63|jsh|63') {
  Write-Error "Refusing seed. Expected upstream demo user 63|jsh|63, got '$identity'. This script only runs on a fresh jshERP demo database imported from jshERP-boot/docs/jsh_erp.sql."
  exit 1
}

$sql = Join-Path $Deploy "sql\02-pcb-demo-master.sql"
Write-Host "Tenant check passed (63|jsh|63). Seeding PCB demo master data ..."
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
docker cp $sql "aierp-mysql:/tmp/02-pcb-demo-master.sql"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker exec aierp-mysql mysql -uroot "-p$rootPwd" --default-character-set=utf8mb4 jsh_erp -e "source /tmp/02-pcb-demo-master.sql"
$code = $LASTEXITCODE
$ErrorActionPreference = $prev
if ($code -ne 0) { exit $code }

$gatewaySql = Join-Path $Deploy "sql\03-aierp-gateway-draft.sql"
Write-Host "Applying gateway draft schema ..."
$ErrorActionPreference = 'Continue'
docker cp $gatewaySql "aierp-mysql:/tmp/03-aierp-gateway-draft.sql"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker exec aierp-mysql mysql -uroot "-p$rootPwd" --default-character-set=utf8mb4 jsh_erp -e "source /tmp/03-aierp-gateway-draft.sql"
$code = $LASTEXITCODE
$ErrorActionPreference = $prev
if ($code -ne 0) { exit $code }
$excelSql = Join-Path $Deploy "sql\04-aierp-excel.sql"
Write-Host "Applying excel preview schema ..."
$ErrorActionPreference = 'Continue'
docker cp $excelSql "aierp-mysql:/tmp/04-aierp-excel.sql"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker exec aierp-mysql mysql -uroot "-p$rootPwd" --default-character-set=utf8mb4 jsh_erp -e "source /tmp/04-aierp-excel.sql"
$code = $LASTEXITCODE
$ErrorActionPreference = $prev
if ($code -ne 0) { exit $code }

$materialSql = Join-Path $Deploy "sql\08-aierp-021b-material-master.sql"
if (Test-Path $materialSql) {
  Write-Host "Applying AIERP-021B material master-data schema ..."
  $ErrorActionPreference = 'Continue'
  docker cp $materialSql "aierp-mysql:/tmp/08-aierp-021b-material-master.sql"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  docker exec aierp-mysql mysql -uroot "-p$rootPwd" --default-character-set=utf8mb4 jsh_erp -e "source /tmp/08-aierp-021b-material-master.sql"
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code -ne 0) { exit $code }
}
Write-Host "Done. Captcha flag was not changed. Re-run is safe: existing demo rows are skipped."
