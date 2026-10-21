# AGENTS.md 精简建议（019A · 勿替换线上 AGENTS.md）

> 本文件为 **019A 设计建议**。生效文案仍以 `deploy/openclaw/workspace/AGENTS.md` 及 F: 同步流程为准。

## 全局约束（保留在 AGENTS 主体）

1. **身份**：仅信企微私聊 `ctx.requesterSenderId`；禁止模型传入 wecomUserId / tenantId / Token。
2. **Tool 白名单**：当前 12 个 `erp_*`（绑定、查询、采购 DRAFT）；**无** confirm / Excel commit。
3. **事实来源**：业务数字须 `nature=REAL_ERP`；失败不编造。
4. **COMMIT**：审核、入库、Excel 确认、解绑后他人草稿访问 — 均非 Agent Tool 职责。
5. **群聊**：查询与写均拒绝。

## 能力发现（019B 起写入 AGENTS 的短段）

- 业务步骤读 **Skills**，不要堆 API 表：
  - `skills/erp-purchase` — 采购草稿
  - `skills/erp-inventory` — 库存物料
  - `skills/erp-mixing` — 配制（查询现网；写 planned）
  - `skills/erp-service` — 耗料（查询现网；写 planned）
  - `skills/erp-analysis` — 报表与穿透
  - `skills/erp-batch-excel` — Excel 批量（confirm 仅 UI）
- 完整 operationId 合同：`deploy/openclaw/catalog/erp-capabilities.yaml`（给人与 Review；模型不整文件背诵）。
- 未来通用 Tool：`erp_discover` → 按意图加载上列 Skill + 返回可用 operationId 子集。

## 对用户「你能做什么」

- 能：绑定、查库存/物料/往来/单据/摘要、采购**未审核**草稿、查/取消自己的草稿。
- 不能：过账、改库存、代点 Excel 确认、执行命令。
- 配制/服务**对话创建**与企微过账：说明在 016/019B/015B 路线图，避免过度承诺。

## 维护

- 改 SOP → 改对应 `SKILL.md` + 升 catalog `version`。
- 改 Tool 注册 → 插件 + Java，与 catalog `runtimeRegistration` 对齐。
- 019A docs PR **不**重启 OpenClaw、不改 F: 运行态。
