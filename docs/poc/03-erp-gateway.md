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

草稿只写入 `aierp_gateway_draft`。确认时调用原生 `DepotHeadService.addDepotHeadAndDetail`（未审核）再 `batchSetStatus=1`。采购为 `入库/采购`，组装为 `其它/组装单`，服务耗料为 `出库/其它` 并带客户 `organId`，不是销售出库。

仓库权限读取当前用户的 `UserDepot`，与系统里“是否启用仓库权限”开关无关。物料、仓库、供应商、客户都必须属于当前租户。同一用户的幂等键重复确认返回原单据号，不会再次过账。库存不足或组装任一行不足时整单拒绝。

## 验收

```powershell
node deploy/scripts/gateway-flow.mjs
```

证据写到 `docs/poc/evidence/gateway-*.json`。断言失败时进程退出码为 1。
