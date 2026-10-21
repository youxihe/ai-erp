# AIERP-015A Review Fix 证据（脱敏）

- Date: 2026-10-21
- Branch: `feat/aierp-015a-purchase-dialog-draft`
- OpenClaw: `F:\\aierp-openclaw`（备份后同步插件/`alsoAllow`/`AGENTS.md`/`contracts.tools`；未重装）
- 身份：`createDraftAs(boundUser, …, WecomDraftOwner)`；草稿绑定 wecomUserId + botId + binding_id + binding_bound_at
- **未注册** `erp_draft_confirm`；适配器无 `/draft/confirm`

## 12 工具加载证据

| 来源 | 数量 | 说明 |
|---|---|---|
| `openclaw.plugin.json` contracts.tools | 12 | erp_bind_start, erp_binding_status, erp_unbind, erp_stock_query, erp_material_search, erp_partner_search, erp_bill_search, erp_bill_detail, erp_report_query, erp_purchase_prepare, erp_draft_status, erp_draft_cancel |
| `openclaw.json` tools.alsoAllow（本机） | 12 | 与模板一致 |
| 插件 `index.js` registerTool 名 | 12 | erp_bill_detail, erp_bill_search, erp_bind_start, erp_binding_status, erp_draft_cancel, erp_draft_status, erp_material_search, erp_partner_search, erp_purchase_prepare, erp_report_query, erp_stock_query, erp_unbind |
| Gateway 启动日志 | — | `aierp-erp-tools` 在 listening 插件列表；重启后无 `contracts.tools` 告警 |
| Agent 实测调用 | ≥5 | 模型实际发起 `erp_material_search` / `erp_bill_search` / `erp_purchase_prepare` / `erp_stock_query` / `erp_binding_status`（CLI 会话无 `requesterSenderId` → `NO_TRUSTED_WECOM_SENDER`，证明工具已挂载且身份闸门生效） |
| Control UI `tools.effective` | — | Gateway 日志 `tools.effective … bytes=23911` |

不含 `erp_draft_confirm`。

## 自动化（无过账）

`deploy/scripts/aierp-015a-draft-flow.mjs` → `aierp-015a-draft-flow.json`：**25/25 PASS**

覆盖：未绑定、伪造身份、真实草稿、幂等、status、无 confirm 路由、坏仓库、库存不变、取消；**双企微同 ERP 隔离**、**解绑重绑拒绝旧草稿**、**CONFIRMED 幂等重放 posted=true**。

## 真实绑定用户 API UAT（企微用户 sid***）

脚本：`deploy/scripts/_wecom-sid-purchase-uat.mjs` → `aierp-015a-wecom-sid-uat.json`

| 项 | 结果 |
|---|---|
| 物料 | 表面活性剂 / RM-A001 |
| 数量单位仓 | 10 L → 原料仓 |
| 供应商 | 华东化工（partner/bill 查询可用） |
| draftId | 105（已取消，脱敏可复用） |
| status | DRAFT → CANCELLED；posted=false |
| 库存 | 158.700000 全程不变 |

## 企微对话

- Gateway 重启后 WeCom WS 已重新认证；`AGENTS.md` 已切到 015A（12 工具）。
- 会话刷新：新建 UAT session key `agent:main:wecom-uat-015a-*`（未删除主会话历史）；并对 `agent:main:main` 使用 `openclaw agent --deliver` 回推企微。
- CLI/`--deliver` 路径下 `requesterSenderId` 为空，工具正确拒绝；**真人从企微私聊再发同一采购句即可带可信发送者完成 prepare**（此前同会话曾成功查库存 RM-A001@原料仓）。

## 本机备份

- `F:\\aierp-openclaw\\state\\openclaw.json.bak-015a-reviewfix-*`
- 插件目录 `aierp-erp-tools.bak-015a-reviewfix-*`
- `AGENTS.md.bak-015a-reviewfix-*`

HEAD（push 前）：`e441e4d11d59802decd81dcd64df42b212039f21`
