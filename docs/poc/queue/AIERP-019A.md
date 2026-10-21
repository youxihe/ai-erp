# AIERP-019A · Agent 自主编排所需 ERP API 能力目录 + SOP Skills（设计与版本化文档）

- **状态**：RELEASED / docs-only / next_order #2，可在 AIERP-015B PR #27 Review Fix Push 后独立开始。
- **分支**：`product/aierp-019a-capability-catalog-skills`（基于最新 origin/master，不从 #27 继承）。
- **执行方**：Cursor 产品/架构 Agent，可让 Cursor 自主调研现有业务 API；**不运行 F: 部署、不开启动态工具或任意写权限**。
- **输入**：`docs/poc/AGENT_CAPABILITY_ARCHITECTURE.md`、`docs/poc/adr/AIERP-014D-conversational-confirmation.md`，源码 `AierpGatewayController`、`AierpWecomController`、已有 12-tool OpenClaw 插件与 jshERP 原生查询/确认 Service。

## 必须交付

1. `deploy/openclaw/catalog/erp-capabilities.yaml`（或 versioned JSON），**逐 operationId**：中文功能名/业务意图、`sideEffectLevel`、准确 `requestSchema/responseSchema`、必填字段、查询日期/分页限制、`erpPermission`、warehouse/tenant scoping、敏感数据字段与允许的错误/下一步行为。每一能力**追溯到真实 Java Controller/Service**及现存 DTO，缺字段不得凭空补造。
2. `deploy/openclaw/catalog/README.md`：开发时如何维护版本、哪些字段需要核对 Java 及如何同步到 Workspace。区分全部“文档可见”与“运行时由服务端授权注册可用”；不把 Controller URL、原生 DAO Table 当可调用工具参数。
3. `deploy/openclaw/workspace/skills/erp-purchase/SKILL.md`、`erp-inventory/SKILL.md`、`erp-mixing/SKILL.md`、`erp-service/SKILL.md`、`erp-analysis/SKILL.md`：**实际安装 OpenClaw 版本**对应 Skills 语法/元数据，在 repo 建可版本化草稿，`AGENTS.md` 只保留全局约束与能力发现指引。每个 skill 写明业务槽位、数据查询、歧义消解、工具顺序/错误处理、何时仅能给草稿、何时需要可信用户确认、回执如何读取。
4. 新增 `deploy/openclaw/workspace/skills/erp-batch-excel/SKILL.md`：请求对应业务模板、收到实际企微文件、解析校验、修正错误、逐单草稿和可信批次确认 SOP；区别采购、销售出库、配制生产和服务耗料；明确 SALE/INITIAL 目前仅模板不可过账，与 `docs/poc/EXCEL_BATCH_DEMO_ACCEPTANCE.md` 对齐。
5. `docs/poc/019a-agent-sop-acceptance.md`：至少 20 个中文真实对话/意图映射（其中至少 5 个 Excel 模板回传/错误/确认场景）；包括“沿用之前供应商”、按原料仓查库存、最近采购、配制、耗料、导入 Excel、复杂客户分析、用户换绑、相同物料多匹配、权限拒绝、同名供应商、重复确认/网络重试。
6. `docs/poc/adr/AIERP-019A-capability-gateway.md`：通用 `erp_discover/erp_query/erp_prepare/erp_receipt` 的输入输出和 Java 执行图、静态 operationId allowlist 与分类权限；不让 LLM 持有任意 HTTP/SQL、数据库密码、管理员 Token、文件系统工具；保留 015B 原始入站确认独立路径。

## 评审标准与接力

- 先覆盖**已实现** 012A/013/015A/015B 的能力，再标注 016/017 的“规划中”，但**不能在文档中把未实现的 mix/service Agent 工具写成当前已可执行**。
- 输出具有工程可执行性：接口、参数、权限、错误和状态完整，避免堆砌抽象 Agent 框架。
- 不要简单给模型上百个原生接口或让用户原话直接变成任意 HTTP 请求。
- **docs-only PR**、`READY_FOR_REVIEW`、HEAD SHA，由 ChatGPT Review/Merge；019B 在此后单独 Release 编码，不需等待 015C 文件发送技术债。

**规划优先级调整**：019A 可与 017A 独立并行，不改变运行中的 F: OpenClaw；019B 的实际动态工具实现须在 017A 客户 Demo 文件闭环验收后排期，避免架构搭建拖慢批量业务体验。
