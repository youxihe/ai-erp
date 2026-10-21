# ERP 能力目录维护说明（AIERP-019A）

本目录存放**版本化、可审阅**的 ERP Agent 能力合同（`erp-capabilities.yaml`）。它是产品/架构文档，不是运行时自动加载的配置；019B 起 Java 侧应维护与之对齐的 **operationId allowlist**。

## 三份资料，勿混用

| 资料 | 路径 | 作用 |
|---|---|---|
| 能力目录 | `deploy/openclaw/catalog/erp-capabilities.yaml` | 业务 operationId、参数、权限、sideEffectLevel、Java 溯源 |
| SOP Skills | `deploy/openclaw/workspace/skills/erp-*/SKILL.md` | Agent 编排顺序、槽位、歧义、确认话术 |
| 运行时注册 | OpenClaw 插件 + 未来 `erp_*` 通用网关 | **实际可执行**的子集；未注册则文档可见但不可调 |

**文档可见 ≠ 运行时可用。** 模型读到 YAML 不会获得新 HTTP 能力。

## 字段维护规则

1. **逐条对齐 Java**：`javaSource` 必须指向本仓库 `com.jsh.erp.gateway.*`（或标注 `PLANNED_*` / `master:` 若分支未合并）。改 Controller/DTO 时同步改 `requestSchema` / `responseSchema` / `errors`。
2. **sideEffectLevel**（四档）：
   - `READ`：可经 019B `erp_query` 暴露给模型（在 allowlist 内）。
   - `DRAFT`：可经 `erp_prepare`；文案必须「未入账/库存未变」。
   - `COMMIT`：`modelCallable: false`；仅会话 UI、Excel 人工确认、015B 可信入站；**禁止** OpenClaw Tool。
   - `HIGH_RISK`：不进 POC Agent 清单。
3. **auth**：写清 `HMAC_WEcom_ADAPTER` vs `ERP_SESSION` vs `trustedInboundEvent`；禁止把 `X-Access-Token`、Adapter Secret、绑定码设计为模型参数。
4. **erpPermission**：功能号与按钮与 `AierpGatewayService` / `AierpWecomQueryService` 常量一致（246 库存、33 采购、232 组装、202 服务）。
5. **warehouseScope / tenantScope**：与 `UserDepot`、`resolveBoundActiveUser`、单据「整单仓库授权」规则一致。
6. **sensitiveFields**：列出不得进入 `details` 给模型的字段（电话、地址、成本、PDF 二进制等）。
7. **implementationStatus**：
   - `IMPLEMENTED`：本分支 Java +（若适用）12 工具已注册。
   - `IMPLEMENTED_SESSION_ONLY`：仅 `/aierp/v1/*` 会话网关。
   - `PLANNED_015B_ON_MASTER` / `PLANNED_016_019B`：文档先行，**不得**在 AGENTS 中写成已上线。

## 版本号

- 递增 `version`（如 `019a.1` → `019a.2`）当：新增 operationId、改 schema、改权限或 sideEffectLevel。
- PR 描述中附「对照 Java 文件列表」便于 Review。

## 禁止事项

- 不要把 jshERP Swagger 全量 URL、Controller `@PostMapping` 路径、MyBatis 表名作为模型 Tool 参数或 Skill 中的「直接调用说明」。
- 不要让 Agent「自己拼 HTTP」；019B 仅允许 `operationId` + JSON body 经 Java 网关。
- 不要把 `excel.confirm`、`draft.confirm`、`draft.confirm.wecom` 注册为 LLM Tool。
- 019A docs PR **不**改 F: 运行态 OpenClaw；模板同步见仓库根 `AGENTS.md` 与 `deploy/scripts/_write_agents_015b.py`（与本目录独立）。

## 与 OpenClaw 插件映射

当前 `aierp-erp-tools` 仅映射 `legacyOpenClawTool` 列出的 12 个名称；其余能力仅在目录中记录，供 019B `erp_discover` 与人类 Review 使用。

## 推荐自检清单（PR 前）

- [ ] 每个 `IMPLEMENTED` 条目能在 `jshERP-boot/.../gateway` 找到方法
- [ ] 所有 `COMMIT` 条目 `modelCallable: false`
- [ ] mix/service 企微 prepare 仍为 `PLANNED`（若分支无 Wecom 路由）
- [ ] Excel `INITIAL`/`SALE` 标注不可 confirm
- [ ] 015B 条目标注分支差异（本 worktree 无 `AierpWecomConfirmService`）
