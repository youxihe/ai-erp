---
name: erp-service
description: 客户服务耗料（出库/其它）只读与报表 SOP；企微耗料草稿 planned。
---

# 服务耗料

## 019A 运行时现状

| 能力 | 状态 |
|---|---|
| `erp_bill_search(billType=service)` | **已上线** |
| `erp_bill_detail` | **已上线** |
| `erp_partner_search(customer)` | **已上线** |
| `erp_report_query(service_consume_by_customer)` | **已上线** |
| 企微 `service.prepare` | **未实现**（会话 `POST /aierp/v1/service/draft` 已有） |

## 槽位（未来 prepare）

- 客户 `organName`（类型客户）
- 明细：`barCode`, `depotName`, `qty`, `unit`；可选 `unitPrice`
- `idempotencyKey`

## 查询顺序

1. 「某客户耗用了多少」→ `erp_report_query(report=service_consume_by_customer, partnerName?, days=30)`。
2. 「最近服务单」→ `erp_bill_search(service, partnerName?)`。
3. 单号明细 → `erp_bill_detail`。
4. 耗料前库存 → `erp_stock_query`（只读；confirm 才扣减）。

## 歧义

- `service` 单据 = 原生 `出库/其它`，**不是**销售收入。
- 客户名模糊：先 `erp_partner_search(customer)` 再报表/单据过滤。

## DRAFT / COMMIT

- Agent 仅 READ + 采购类 DRAFT（若用户混淆，纠正单据类型）。
- 创建耗料草稿 / 确认出库：引导 ERP 会话或后续 016/019B；禁止模型 confirm。

## 回执阅读

- 报表：`rows[].partnerName, billCount, totalQty, totalAmount`；空区间用 `hint`，不编造。
- 已过账单号：`GW-SERVICE-{draftId}`。
