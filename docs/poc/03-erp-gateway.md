# AIERP-003 · 真实业务网关

网关挂在现有 jshERP 会话上（请求头 `X-Access-Token`）。不使用固定的 `jsh` 身份代替其他用户，也不直接改库存表。

## 接口

| 能力 | 方法 | 路径 |
|---|---|---|
| stock.query | POST | `/jshERP-boot/aierp/v1/stock/query` |
| purchase.createDraft | POST | `/jshERP-boot/aierp/v1/purchase/draft` |
| mix.createDraft | POST | `/jshERP-boot/aierp/v1/mix/draft` |
| service.createDraft | POST | `/jshERP-boot/aierp/v1/service/draft` |
| draft.confirm | POST | `/jshERP-boot/aierp/v1/draft/confirm` |
| report.summary | POST | `/jshERP-boot/aierp/v1/report/summary` |

草稿只写入 `aierp_gateway_draft`。表由 `deploy/sql/03-aierp-gateway-draft.sql` 在 `seed-demo.ps1` 里幂等创建，应用启动不再执行 DDL。确认时调用原生 `DepotHeadService.addDepotHeadAndDetail`（未审核）再 `batchSetStatus=1`。采购为 `入库/采购`，组装为 `其它/组装单`，服务耗料为 `出库/其它` 并带客户 `organId`，不是销售出库。

采购单 `changeAmount=0`、`payType=记账`，不把货款记成已付。单据号是 `GW-{业务类型}-{草稿主键}`，创建后只按当前 `tenant_id` 查找并审核。

写操作除仓库 `UserDepot` 外，还要求角色功能按钮：库存查询需要功能 246；采购草稿需要功能 33 的新增按钮 `1`，确认需要审核按钮 `7`；组装对应 232；其它出库对应 202。没有按钮记录则拒绝。

确认前先按仓库和物料排序获取进程内公平锁，再开启过账事务。后到的确认会在前一张提交之后才读取余额。事务内另外持有 MySQL `GET_LOCK`，事务结束释放。这只覆盖本网关进程。原生界面直接过账不走这把锁。

仓库权限读取当前用户的 `UserDepot`，与系统里“是否启用仓库权限”开关无关。物料、仓库、供应商、客户、结算账户在确认时按当前租户重检。同一用户的幂等键重复确认返回原单据号，不会再次过账。库存不足或组装任一行不足时整单拒绝。

## 验收

```powershell
node deploy/scripts/gateway-flow.mjs
```

证据写到 `docs/poc/evidence/gateway-*.json`。断言失败时进程退出码为 1。
