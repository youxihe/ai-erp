# AI-ERP Cursor Agent · 2026-10-21 Next tasks

仓库严格限定 `youxihe/ai-erp`。正式 OpenClaw 是 Windows native `F:\aierp-openclaw`，不重新安装、不升级、不修改其它项目。企微 + DeepSeek + 绑定 ERP 真库存已可用。

## #1：AIERP-013 PR #21 Review Fix

跨仓混合单据：仅当**所有有效明细仓库均在用户 UserDepot 授权内**时，才允许返回列表/详情表头与整单金额；否则 403/不出现在列表。已补可恢复的低权限 fixture 测试。状态 **REVIEW_FIX_PUSHED**；Cursor 不自行 Merge。

P1（技术债）：跨单位数量求和、`出库/其它` 与严格服务耗料口径——见 `docs/poc/TECH_DEBT.md`。

## #2：AIERP-015A（正式 RELEASED，可接力）

013 修复 Push 后，从最新 `origin/master` 建 `feat/aierp-015a-purchase-dialog-draft`（勿从 013 未合并分支派生）。

阅读 `docs/poc/queue/AIERP-015A.md`、`docs/poc/adr/AIERP-014D-conversational-confirmation.md`、`docs/poc/14d-api-contract.md`。

交付：企微多轮采购 → 真实未审核 DRAFT（库存不变）→ 中文摘要。禁止假 session / 管理员 Token / 模型 confirm 工具。完成后 `READY_FOR_REVIEW`。

## 安全/运维
不将 HMAC 密钥、挑战码、聊天记录、ERP 密码放到 Git。双真实企微/低权限 UAT 仍 `NOT_VERIFIED`。
