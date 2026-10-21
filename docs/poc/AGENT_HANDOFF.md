# AI-ERP Cursor Agent · 交接（015B+017A 统一插件）

## PR #27 AIERP-015B

- 冲突已与 master（含 019A）和解并 Push；待 ChatGPT Merge。
- 真人企微 #111 → `GW-PURCHASE-111` 已过账；**勿重跑**破坏性确认。

## PR #30 AIERP-017A（本分支）

- 已合入 master + 015B 确认/授权代码。
- **统一插件**：12 ERP 工具 + `erp_excel_template`（支持 `rows` 预填）+ `before_dispatch` 采购确认钩子 + Excel 入站预览钩子。
- **禁止**模型注册 `erp_draft_confirm` / `excel.confirm`。
- AGENTS：单张采购可由企微原文确认入库；Excel 仅模板+预览，无批量过账。
- 验收门槛：真人企微收到可编辑预填 XLSX → 回传 → 真实预览；库存不变。不自行 Merge。
