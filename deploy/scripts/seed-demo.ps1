$ErrorActionPreference = "Stop"
$Deploy = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $Deploy ".env"
$rootPwd = "aierp_root_change_me"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*AIERP_MYSQL_ROOT_PASSWORD=(.+)$') { $rootPwd = $Matches[1].Trim() }
  }
}
$sql = Join-Path $Deploy "sql\02-pcb-demo-master.sql"
Write-Host "Seeding PCB demo master data ..."
docker cp $sql "aierp-mysql:/tmp/02-pcb-demo-master.sql"
docker exec aierp-mysql mysql -uroot "-p$rootPwd" --default-character-set=utf8mb4 jsh_erp -e "source /tmp/02-pcb-demo-master.sql"
Write-Host "Done."
