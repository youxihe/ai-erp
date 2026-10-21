# AIERP-015B · Review Fix 授权收口证据（PR #27）

**HEAD 以 Push 后 SHA 为准。** 真人企微 #111 / GW-PURCHASE-111 未重跑过账。

## 修复

1. **ERP Session `confirm-ui`**：`AierpWecomConfirmService.confirmUi` 经 `requireLiveOwnerMatchingDraft` 重验 ACTIVE 绑定 + `binding_id`/`binding_version`；解绑或换绑后拒绝旧草稿。
2. **PDF `receipt/pdf`**：`loadPdfBytes` 调用 `assertSessionUserLive` + 单据仓库整单授权（UserDepot）；禁用用户 / 撤仓后 403。

## 自动化（隔离 fixture，无破坏性过账）

脚本：`deploy/scripts/aierp-015b-authz-fix.mjs`  
结果：`docs/poc/evidence/aierp-015b-authz-fix.json`

| 用例 | 结果 |
|---|---|
| confirm-ui 解绑后拒绝 | PASS（403 企微绑定已解除） |
| confirm-ui 换绑后代际拒绝 | PASS（403 绑定已更新） |
| PDF 当前 actor 可读 | PASS（GW-PURCHASE-111，~58KB） |
| PDF 未知 receiptId | PASS（404） |
| PDF 用户禁用 | PASS（403） |
| PDF 仓库权限清空 | PASS（403） |
| PDF 恢复后可读 | PASS |

**ALL_PASS 18**（含 fixture 绑定/草稿清理；草稿 #112 仅 CANCELLED，未入库）。
