# AI-ERP Cursor Agent · 交接（merge-conflict 收口后）

**保留 master 队列与 019A 文档**；本文件仅作当前执行状态摘要。

## AIERP-015B PR #27（本分支，待 ChatGPT Merge）

- HEAD：见分支 tip（含 authz Review Fix：`confirmUi` 重验 ACTIVE binding_version；PDF 重验用户/仓库）。
- 真人企微 #111 → `GW-PURCHASE-111` 已过账；**勿重跑**破坏性确认。
- 证据：`docs/poc/evidence/aierp-015b-confirm.*`、`aierp-015b-authz-fix.*`（18/18）。
- 与 master 冲突已解：保留 master `QUEUE.md` / 019A catalog；本分支仅保留 015B Java/SQL/插件能力。

## AIERP-017A PR #30（并行，须与 015B 钩子共存）

- Excel 模板/预览后端已通；**F: 运行态须同时保留** `before_dispatch` 采购确认钩子 + `erp_excel_template` + Excel 入站预览。
- 禁止用 017A 覆盖插件导致丢失 015B 确认。
- 批量过账属 017B/017C，未释放。

## AIERP-019A（已 Merge）

- master `6a447f13`：能力目录与 SOP Skills；勿用旧 HANDOFF 覆盖。

## 规则

- Cursor 不自行 Merge；更新 F: 前备份；仅集成回归通过的插件版本可写共享 OpenClaw。
