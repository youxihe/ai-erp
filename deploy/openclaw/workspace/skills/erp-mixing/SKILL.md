---
name: erp-mixing
description: 组装配制（药水配制）查询 SOP；企微写草稿 planned，会话网关已实现。
---

# 组装配制 / 药水配制

## 019A 运行时现状

| 能力 | 状态 |
|---|---|
| `erp_bill_search(billType=mix)` | **已上线**（只读） |
| `erp_bill_detail`（组装单号） | **已上线** |
| `erp_stock_query`（原料/成品仓） | **已上线** |
| 企微 `mix.prepare` / `erp_mix_prepare` | **未实现**（016/019B；Java 仅有 `POST /aierp/v1/mix/draft` 会话网关） |

Agent **不得**声称已在企微创建配制草稿或过账。

## 业务槽位（未来 prepare）

- 成品：`finished.barCode`, `depotName`, `qty`, `unit`
- 原料行：`lines[].barCode`, `depotName`, `qty`, `unit`（至少一行）
- `idempotencyKey`、备注

## 只读编排顺序

1. 用户问「最近配制/组装」→ `erp_bill_search(mix, days=7~90)`。
2. 指定单号 → `erp_bill_detail`。
3. 查原料是否够 → 对每条子件 `erp_stock_query`（出库方向库存仅在 confirm 后变化，查询时如实读当前值）。

## 歧义

- 单据语义：`mix` = 原生 `其它/组装单`，**不是**销售出库。
- 若租户存在同 type 非服务单据，以 Java 映射为准；不确定时引导用户提供 `GW-MIX-*` 或原生单号。

## DRAFT / COMMIT

- 019A：仅可解读历史单据与库存；若用户要「配制 100L FG-101」→ 说明企微草稿功能待 016/019B，可引导 PC Demo 工作台 Excel（`erp-batch-excel`）或 ERP 页面。
- 任何过账须 **COMMIT** 通道，非 Agent Tool。

## 回执

- 只读：表头 `billTypeLabel`、行 `materialType`（组合件/子件）。
- 过账后单号：`GW-MIX-{draftId}`（会话 confirm 路径；企微 confirm 015B 未在本分支合并）。
