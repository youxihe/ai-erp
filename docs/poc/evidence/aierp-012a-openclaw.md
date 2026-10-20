# AIERP-012A 证据（脱敏）

- Date: 2026-10-21（Review Fix P0-1 / P0-2）
- Branch: `feat/aierp-012a-wecom-readonly-stock`
- OpenClaw: Windows native `F:\aierp-openclaw`（未重装/未升级）
- Plugin: `@aierp/erp-tools`（仓库路径 `deploy/openclaw/plugins/aierp-erp-tools`；已同步 `state/extensions/aierp-erp-tools`）
- WeCom channel: `@wecom/wecom-openclaw-plugin@2026.7.2`

## 身份结论（非 BLOCKED）

官方插件 Tool 工厂使用：

`ctx.messageChannel === "wecom" ? ctx.requesterSenderId : undefined`

入站 `monitor.js` 将 Bot WS `body.from.userid` 写入 `SenderId`。  
AIERP 工具复制该模式，**忽略**模型传入的 wecomUserId/tenantId/erpUserId/token。详见 `docs/poc/adr/AIERP-012A-wecom-identity-binding.md`。

## Review Fix（P0）

- **P0-1**：移除可用默认 HMAC；Boot 启动与请求均 fail-closed；缺密钥/错密钥/正确密钥/nonce 重放均有自动化覆盖。本机 `deploy/.env` 与 `F:\aierp-openclaw\state\.env` 共用高熵密钥（未进 Git）。
- **P0-2**：禁用用户 / 停用租户 / 过期租户 → 库存拒绝；恢复后按当前账号权限再查成功。
- **DM**：工具层检测 group/channel（chatType / sessionKey / nativeChannelId）；官方 SDK 有 chatType，ToolContext 基类未必透传。
- **Nonce**：进程内短期去重已落地；跨实例持久化列为技术债。

## 自动化隔离测试（单合成企微用户）

脚本：`deploy/scripts/aierp-012a-readonly-flow.mjs`  
结果：`docs/poc/evidence/aierp-012a-readonly-flow.json` → **17/17 PASS**

覆盖：缺失签名、错误密钥、正确密钥、nonce 重放、未绑定、claim、复用码、伪造身份字段、绑定后库存（表面活性剂/RM-A001/原料仓/L）、其他企微未绑定、禁用用户、停用租户、过期租户、恢复后查询、解绑、未知码。

示例库存行（脱敏）：`materialName=表面活性剂, barCode=RM-A001, depotName=原料仓, unit=L, currentStock=<real>`。

**说明**：本套件是单用户服务端隔离测试，**不是**双真实 ERP 用户企微权限 UAT。

## 人工企微 UAT（双真实用户权限）

- **状态**：`NOT_VERIFIED`
- 需两个真实企微身份 + 两个不同仓库权限的 ERP 账号；不以管理员共享 Token 冒充。

## 本机配置变更（未进 Git）

- 备份：`F:\aierp-openclaw\state\openclaw.json.bak-012a-*`
- `plugins.entries.aierp-erp-tools.enabled=true`
- `tools.alsoAllow`: 仅四个 `erp_*` 工具
- `deploy/.env` + `state/.env`：`AIERP_WECOM_ADAPTER_SECRET`（高熵，已轮换）/ `AIERP_ERP_BASE_URL`
- `workspace/AGENTS.md` 同步为 012A 能力说明
