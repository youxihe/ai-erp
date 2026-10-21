# AI-ERP Cursor Agent · 015B READY_FOR_REVIEW（2026-10-21）

**实现分支**：`feat/aierp-015b-trusted-confirm-receipt`  
**自动化过账样例**：原生单号 **`GW-PURCHASE-110`**，库存 `RM-A001@原料仓` 159.7→160.7；**未**自动确认用户草稿 #106。

## 已完成
1. **可信确认**：OpenClaw `before_dispatch` 取得 `senderId` + 原文 + `messageId` → HMAC `/aierp/v1/wecom/draft/confirm`（`eventSource=WECOM_BEFORE_DISPATCH`）。无 `erp_draft_confirm` 工具。
2. **显式 actor 过账**：`confirmAs` / `postNativeBillAs` / `addDepotHeadAndDetailAs` / `batchSetStatusAs`；不伪造 Session。
3. **binding_version** 单调代际；挑战表 + 幂等重放。
4. **文本回执 P0** + **PDF_GENERATED**（容器文泉驿字体）；**PDF_DELIVERY_NOT_VERIFIED**（待真人企微打开）。
5. ERP 保底：`POST /aierp/v1/wecom/draft/confirm-ui` + `/receipt/pdf`。

## 证据
- `docs/poc/evidence/aierp-015b-confirm.md`
- `docs/poc/evidence/aierp-015b-confirm-flow.json`
- `docs/poc/evidence/aierp-015b-openclaw.md`
- `docs/poc/evidence/receipts/sample-GW-PURCHASE-110.pdf`

## 下一步（Reviewer / 用户）
- 真人企微：新建草稿 → 回复「确认采购{id}」→ 核对回执与 PDF 附件。
- ChatGPT Review 通过后再 Merge；016 配制/耗料复用本确认能力。
- 双企微不同仓库 UAT 仍 `NOT_VERIFIED`。
