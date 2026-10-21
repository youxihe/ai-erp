---
name: erp-purchase
description: 企微私聊采购入库 SOP——查供应商与物料、创建未审核草稿、引导可信确认；不过账、不编造金额。
---

# 采购入库（企微 Agent SOP）

## 适用能力（019A 已上线 Tool）

`erp_material_search`、`erp_partner_search`、`erp_stock_query`、`erp_bill_search`、`erp_bill_detail`、`erp_report_query`、`erp_purchase_prepare`、`erp_draft_status`、`erp_draft_cancel`。

**不可用（勿声称已执行）**：`erp_draft_confirm`、企微直接过账、Excel 批次确认。

## 业务槽位

| 槽位 | 必填 | 解析方式 |
|---|---|---|
| 物料 | 是 | `barCode` 优先；模糊则 `erp_material_search` |
| 数量 + 单位 | 是 | 与物料主数据单位一致 |
| 入库仓库 | 是 | 名称匹配；无权限则 403 |
| 供应商 | 是 | `erp_partner_search(supplier)`；同名多条须用户点选 |
| 幂等键 | 是 | 同一对话同一采购意图保持稳定字符串 |
| 备注 | 否 | 默认「企微对话采购草稿」 |

## 推荐查询顺序

1. 未绑定 → 引导 `erp_bind_start` / 工作台绑定（不索要 ERP 密码）。
2. 意图含「之前/上次/老供应商」→ `erp_bill_search(billType=purchase, partnerName?, days=90)` 取最近供应商名，**再** `erp_partner_search` 确认启用；查不到则列候选，禁止编造。
3. 物料口语 → `erp_material_search`；`ambiguous=true` 时只问编码，一次 1–2 个问题。
4. 需要参考库存 → `erp_stock_query`（可选仓库）。
5. 槽位齐 → `erp_purchase_prepare`。
6. 用户问进度 → `erp_draft_status(draftId)`；取消 → `erp_draft_cancel`。

## 歧义与多匹配

- 物料多候选：展示编码列表，要求用户确认 `barCode`。
- 供应商同名：展示 `partnerId`+名称+启停，让用户选一条；`resolveOrgan` 在 Java 取第一条——Agent 必须在多匹配时主动澄清。
- 多个待确认草稿：取消/状态必须带 `draftId`；不要猜「最新一条」除非用户明确且仅一条 DRAFT。

## 副作用边界

- **仅 DRAFT**：prepare / cancel；成功后文案含「待确认、未入库、库存未变」。
- **COMMIT**：用户说「确认入库/审核」→ 说明当前阶段需 **015B 可信确认**（原文回复或 ERP 页面），Agent **不得**调用任何 confirm Tool。

## 回执阅读

- 草稿：`details.draftId`、`details.summary`、`statusLabel=待确认、未入库`。
- 已过账（仅用户完成 015B 后）：`billNumber` 形如 `GW-PURCHASE-{id}`；库存变化以 ERP 返回为准，不估算。
- 015B PDF/文本回执：由服务端生成；Agent 只转述 `receiptText`，不构造 PDF 链接（尤其 localhost）。

## 错误处理

| 现象 | 动作 |
|---|---|
| 403 功能/仓库 | 说明权限不足，建议换 ERP 账号或管理员授权 |
| 409 幂等冲突 | 换 idempotencyKey 或沿用原草稿查 status |
| 400 单位/仓库 | 引用 `erp_material_search` / 仓库全称重问 |
