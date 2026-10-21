# AIERP-017A Review Fix Round 3 · 文件字节预览（2026-10-21）

## Status: `REVIEW_FIX_PUSHED`

## Root cause

`message_received` / `inbound_claim` 不能可靠改写 LLM 输入（OBSERVE / owner-only）。Agent 在未取得 previewId 时按文件名 `---100L---` 调用 `erp_purchase_prepare` → 草稿 #113。**勿确认 #113。**

## Fix

1. `message_received`：await 真实 xlsx 字节 → ERP preview；脱敏日志（messageId hash / sender mask / sha256 / previewId）
2. `before_dispatch` claim：返回 PREVIEWED（单元格数量）或 FILE_PARSE_FAILED；确认采购钩子仍在同一 hook
3. Redis 文件工作流 + `before_tool_call` / Java `purchasePrepare` 门禁：打开时拒绝 prepare
4. 「取消文件」关闭工作流

## Local evidence（non-posting）

| Suite | Result |
|---|---|
| `aierp-017a-filename-vs-cells` | **7/7 PASS** — 文件名 `---100L---`，单元格 20L，preview 报 20；prepare 被 409 拦截；库存不变 |
| `aierp-017a-excel-preview-flow` | **14/14 PASS** |
| Stock RM-A001@原料仓 | **170.7 不变** |

## Live WeCom

F: 插件已备份并同步；Gateway 重启中。请用户再发 `采购入库模板---100L---.xlsx`（单元格 20L）验收 PREVIEWED。`LIVE_WECOM_FILE_PREVIEW=PENDING_USER_DM`。
