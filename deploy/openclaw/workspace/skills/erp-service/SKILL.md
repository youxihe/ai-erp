---
name: erp-service
description: 客户服务耗料（出库/其它）草稿与只读报表 SOP；确认仅可信私聊「确认耗料{数字}」。
---

# 服务耗料（AIERP-016S）

## 运行时能力

| 能力 | 状态 |
|---|---|
| `erp_bill_search(billType=service)` | 已上线 |
| `erp_bill_detail` | 已上线 |
| `erp_partner_search(customer)` | 已上线 |
| `erp_report_query(service_consume_by_customer)` | 已上线 |
| `erp_service_prepare` | **016S 已上线**（DRAFT only） |
| 确认 | **原文** `确认耗料{draftId}`（before_dispatch），**无**模型 confirm 工具 |

## 槽位

- 客户 `organName`（ERP 真实 `type=客户`）
- `serviceProject`（可选）
- 明细：`barCode`（如 FG-101）, `depotName`（成品仓）, `qty`, `unit`
- `idempotencyKey`

## 流程

1. 查客户 / 库存 → `erp_partner_search` / `erp_stock_query`
2. 槽位齐全 → `erp_service_prepare` → 展示预计扣减，**库存不变**
3. 用户私聊回复 `确认耗料{数字草稿号}` → 原生 `出库/其它` 已审核，成品仓扣减
4. 回执标题《服务耗料出库回执》；专用 PDF 模板尚未交付时以文字为准

## 禁止

- 不得当销售出库 / 开票 / 应收
- 不得用 `确认采购` / 单独「确认」审核服务耗料单
- 不得注册或调用模型 confirm 工具
