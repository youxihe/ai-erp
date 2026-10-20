# AIERP-012A 证据（脱敏）

- Date: 2026-10-20
- Branch: `feat/aierp-012a-wecom-readonly-stock`
- OpenClaw: Windows native `F:\aierp-openclaw`（未重装/未升级）
- Plugin: `@aierp/erp-tools`（仓库路径 `deploy/openclaw/plugins/aierp-erp-tools`）
- WeCom channel: `@wecom/wecom-openclaw-plugin@2026.7.2`

## 身份结论（非 BLOCKED）

官方插件 Tool 工厂使用：

`ctx.messageChannel === "wecom" ? ctx.requesterSenderId : undefined`

入站 `monitor.js` 将 Bot WS `body.from.userid` 写入 `SenderId`。  
AIERP 工具复制该模式，**忽略**模型传入的 wecomUserId/tenantId/erpUserId/token。详见 `docs/poc/adr/AIERP-012A-wecom-identity-binding.md`。

## 自动化隔离测试

脚本：`deploy/scripts/aierp-012a-readonly-flow.mjs`  
结果：`docs/poc/evidence/aierp-012a-readonly-flow.json` → **10/10 PASS**

覆盖：无签名拒绝、未绑定拒绝、claim、复用码拒绝、伪造身份字段拒绝、绑定后库存（表面活性剂/RM-A001/原料仓/L/数量）、其他企微用户未绑定、解绑、未知码。

示例库存行（脱敏）：`materialName=表面活性剂, barCode=RM-A001, depotName=原料仓, unit=L, currentStock=<real>`。

## 人工企微 UAT

- **状态**：`NOT_VERIFIED`（需真实企微私聊：绑定ERP → PC 输入码 → 查表面活性剂库存）
- 第二企微身份 / 低权限仓库用户：未在本机准备时标 **NOT_VERIFIED**，不以管理员共享 Token 冒充。

## 本机配置变更（未进 Git）

- 备份：`F:\aierp-openclaw\state\openclaw.json.bak-012a-*`
- `plugins.entries.aierp-erp-tools.enabled=true`
- `tools.alsoAllow`: 仅四个 `erp_*` 工具
- `state/.env` 增加 `AIERP_WECOM_ADAPTER_SECRET` / `AIERP_ERP_BASE_URL`（与 `deploy/.env` 对齐）
- `workspace/AGENTS.md` 同步为 012A 能力说明
