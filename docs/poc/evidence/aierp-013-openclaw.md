# AIERP-013 证据（脱敏）

- Date: 2026-10-21
- Branch: `feat/aierp-013-business-query-tools`
- OpenClaw: Windows native `F:\aierp-openclaw`（未重装/未升级）
- Plugin: `deploy/openclaw/plugins/aierp-erp-tools` → 同步 `state/extensions/aierp-erp-tools`
- 前置：AIERP-012A 可信身份 / HMAC / 绑定保留兼容

## 新增只读工具

| Tool | 后端路径 | 权限要点 |
|---|---|---|
| `erp_material_search` | `/material/search` | 功能 246；租户物料 |
| `erp_partner_search` | `/partner/search` | 供应商→33 / 客户→202；无电话地址 |
| `erp_bill_search` | `/bill/search` | purchase/mix/service + UserDepot |
| `erp_bill_detail` | `/bill/detail` | 租户 + 仓库明细授权 |
| `erp_report_query` | `/report/query` | 后端聚合；空区间 hint |

原有 `erp_bind_*` / `erp_stock_query` 保持可用。无草稿确认/写库存工具。

## 自动化（无过账）

脚本：`deploy/scripts/aierp-013-query-flow.mjs`  
结果：`docs/poc/evidence/aierp-013-query-flow.json` → **19/19 PASS**（无过账）

覆盖：未绑定拒绝、绑定、伪造身份、物料、供应商/客户、三类单据列表、单据明细、超长日期拒绝、采购汇总、客户耗料汇总、不支持报表、库存兼容、解绑。

交叉核对样例（脱敏）：物料 `表面活性剂/RM-A001`；供应商含「华东」；客户含「苏州」；明细 `GW-PURCHASE-94` 含 RM-A001@原料仓。

## 人工企微 UAT

- 本机 Gateway 已同步插件与 `alsoAllow` 并重启（http 200）；保留既有企微 Bot，未重装 OpenClaw。
- 双真实用户不同仓库权限：`NOT_VERIFIED`

## 本机配置

- 备份：`F:\aierp-openclaw\state\openclaw.json.bak-013-*`、`AGENTS.md.bak-013-*`
- `tools.alsoAllow` 增加五个只读工具（另保留 012A 四个）
- 插件已同步 `state/extensions/aierp-erp-tools`
