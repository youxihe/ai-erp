# AI-ERP Cursor Agent · 017A READY_FOR_REVIEW（2026-10-21）

## PR #27（等待 ChatGPT Review，不 Merge）
- 分支：`feat/aierp-015b-trusted-confirm-receipt`
- **HEAD**：`2b645be2` — confirm-ui 重验 ACTIVE `binding_version`；PDF 重验用户/仓库权限
- 证据：`docs/poc/evidence/aierp-015b-authz-fix.*` ALL_PASS 18；未重跑 #111 过账

## AIERP-017A（本棒）
- 分支：`feat/aierp-017a-wecom-xlsx-inbound-preview`
- **HEAD**：`d4fede6f76e2dddc7acceb9ca985f6a49b89f8cd`
- HMAC：`/aierp/v1/wecom/excel/template` + `/preview`（`templateAs`/`previewAs`）
- OpenClaw：`erp_excel_template` + 入站 xlsx 预览钩子；**无** `excel.confirm`
- SALE：仅模板；PURCHASE/MIX/SERVICE 预览；库存不变
- 证据：`docs/poc/evidence/aierp-017a-excel-preview.md` ALL_PASS 14
- F: 已备份 `openclaw.json` / 插件并 `restart.ps1`（PID 见健康检查）

## 019A（并行 docs）
- 分支：`product/aierp-019a-capability-catalog-skills` HEAD `862a1fab`（含更新后的 `erp-batch-excel/SKILL.md`）

## 未做
- 017B 批次草稿、017C 可信批量过账；Cursor 不自行 Merge。
