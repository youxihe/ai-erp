---
name: erp-analysis
description: 经营摘要与单据穿透只读分析——报表、单据列表、明细组合；禁止编造 KPI。
---

# 经营分析（只读）

## 能力

- `erp_report_query`：`purchase_in_summary`、`service_consume_by_customer`
- `erp_bill_search` + `erp_bill_detail`（穿透）
- `erp_partner_search`（过滤客户/供应商）
- 可选 `erp_stock_query`（现状快照，非历史台账）

## 典型意图 → 编排

| 意图 | 步骤 |
|---|---|
| 本周采购入库多少 | `report=purchase_in_summary, days=7` |
| 某客户耗料排名 | `service_consume_by_customer, days=30` |
| 最近和华东化工的采购 | `bill_search(purchase, partnerName=华东化工)` → 可选 detail |
| 「之前那家供应商」 | `bill_search(purchase, limit=10)` 按时间读 partnerName → partner_search 验证 |

## 日期与限额

- 跨度 ≤ **90 天**；默认近 7 天。
- 列表默认 10 条、最大 50；报表服务分组最多 20 客户。

## 歧义

- 用户说「销售额」：说明当前 Agent 仅覆盖采购入库/服务耗料/组装，**无**销售出库 Agent 报表；可提 SALE Excel 仅模板。
- 未审核 vs 已审核：报表仅 **已审核**；查未审单用 `bill_search(status=未审核)`。

## 副作用

- 全部 **READ**；不得 prepare/confirm。
- 输出注明「数据来自 ERP，非模型估算」；`totals` / `rows` 为空时用 `hint`。

## 权限

- 采购报表要功能 33；服务报表要 202；单据/明细另验仓库整单授权。

## 回执

- 汇总：`totals.billCount, totalQty, totalAmount`
- 穿透：先列表后 detail，避免一次猜单号
