# AIERP-015A 证据（脱敏）

- Date: 2026-10-21
- Branch: `feat/aierp-015a-purchase-dialog-draft`
- OpenClaw: `F:\aierp-openclaw`（备份后同步插件/`alsoAllow`/`AGENTS.md`；未重装）
- 身份：`createDraftAs(boundUser, …)` 显式 ERP actor；**无**假 Session / RequestContextHolder / 管理员 Token
- **未注册** `erp_draft_confirm`；适配器无 `/draft/confirm`

## 工具

| Tool | 路径 | 说明 |
|---|---|---|
| `erp_purchase_prepare` | `/purchase/prepare` | 真实 `aierp_gateway_draft` status=DRAFT |
| `erp_draft_status` | `/draft/status` | 仅本人草稿 |
| `erp_draft_cancel` | `/draft/cancel` | DRAFT→CANCELLED |

## 自动化

`deploy/scripts/aierp-015a-draft-flow.mjs` → `aierp-015a-draft-flow.json`  
覆盖：未绑定、伪造身份、真实草稿、幂等重放/冲突、status、无 confirm 路由、坏仓库、**库存不变**、取消后库存仍不变。

## 双用户 UAT

`NOT_VERIFIED`

## 说明

013 查询工具未合并前，对话侧用库存查询 + 用户确认编码完成槽位；prepare 本身用条码/供应商名走现网 `normalize`/`resolveLine`。
