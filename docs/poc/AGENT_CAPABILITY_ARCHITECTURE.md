# AI ERP Agent 2.0 · API 能力目录 + SOP Skills + 安全执行网关

**日期：2026-10-21**。本文件是待设计落实的产品技术方向，不能误称运行环境已经使用动态调用。

## 产品决策

从“每个业务场景单独写一个 OpenClaw Tool”改为“**Agent 按授权能力发现 → SOP 引导 → 组合查询/准备草稿 → 用户可信确认 → ERP 原生事务 → 回执**”。

- **OpenClaw + DeepSeek**：自主理解用户意图、消除歧义、向用户收集数据、组合已授权 API、决定文本/表格/文件输出方式。
- **文档**：可读的 ERP OpenAPI 子集与版本化业务 SOP，按任务加载，不把所有 API 塞进 AGENTS.md；建议工作区 `skills/erp-inventory/SKILL.md`、`erp-purchase`、`erp-mixing`、`erp-service`、`erp-analysis`。
- **Java ERP Tool Gateway**：静态审定 operationId、参数 JSON Schema、数据范围、查询限额、身份委托、角色/仓库/租户、幂等、审计及正式提交，提供模型只可见的 `erp_discover`、`erp_query`、`erp_prepare`、`erp_receipt` 通用接口。
- **原生 jshERP**：物料/客户/仓库、业务单据、库存、原生审核/过账、会计影响的最终权威。

`erp_confirm` **不是通用模型可调用的 Tool**。真实企微本人确认必须来自可信入站原文消息或已登录 ERP 页面，签发单次挑战/服务端验证后才提交。模型不能拥有任意 HTTP 请求、SQL 或导出非授权数据的能力。

## 必须区分的三份资料

1. **ERP API 真实接口合同**：从本仓库 Java Controller/Service/DTO 校验而来（不是照抄所有 jshERP 管理 API）；openapi/JSON Schema 包含每个 operationId 的输入、输出、错误、分页、角色、敏感字段、sideEffectLevel 与 tenantScope。
2. **业务 Skills/SOP**：详细指导采购、配制、服务耗料、库存/分析业务步骤及槽位追问、用户中断与异常补救。这是**软性的 AI 行为约定**，不等于实际权限或允许过账。
3. **服务端授权能力注册表**：仅在服务器 allowlist 注册并审计的 operationId 才可执行。文档中出现的未开放 API 不会因 Agent 阅读过文档而自动可用。

## 通用 Tool 分层

| Tool | 允许 Agent 自主程度 | 执行安全 |
|---|---|---|
| `erp_discover` | 根据查询意图找到当前用户有权使用的能力、必填参数及返回字段 | 不返回未经授权 operationId / 私有 URL / 系统表名 |
| `erp_query` | 物料、往来单位、库存、单据明细、经营报表，组合多次调用 | `operationId` 枚举/白名单；限额/日期跨度/仓库过滤在 Java；统一 actor |
| `erp_prepare` | 按 SOP 收集字段、校验真实主数据、创建采购/配制/耗料等无入账草稿 | sideEffectLevel=DRAFT；草稿 owner、幂等及当前权限，**库存不变化** |
| `erp_receipt` | 查询已审核单据及归属自己的回执、PDF 状态 | Java 实时重验账单、权限、会话绑定版本；不接任意文件路径 |
| **可信确认通道（非 Tool）** | 用户在企微本人发送原始消息/点击真正卡片或 ERP 已登录页面确认 | 可信消息身份与草稿、挑战、版本及 payload hash 一致，一次性原生过账 |

建议核心接口：`POST /aierp/v1/agent/discover`、`POST /aierp/v1/agent/query`、`POST /aierp/v1/agent/prepare`、`POST /aierp/v1/agent/receipt`；这只是候选，**不得让 Java 接收任意 URL/path/method 或 raw SQL**，也不得代替既有 012A HMAC 和 015B 可信确认。

## 操作分类及审核矩阵

| 级别 | 举例 | 默认 |
|---|---|---|
| `READ` | 物料、库存、客户供应商、已审单据、受控聚合 | 允许 Agent 经当前 ERP 用户授权执行 |
| `DRAFT` | 新建/修改/取消草稿 | 允许 Agent 经后端明确校验与 owner 检查执行，文案必须“未入账” |
| `COMMIT` | 采购确认/组装过账/服务耗料提交 | **仅受信任的独立用户确认入口**；模型调用拒绝 |
| `HIGH_RISK` | 删除、反审核、跨租户、库存手改、结算、批量改数据 | 不在 POC Agent 能力清单，待独立审批系统 |

对于用户未覆盖的自然语言需求：Agent 可以制定只读方案/问用户/查找能力目录并组合**已经授权的操作**；遇到没有开放的副作用操作必须回答无法执行并提出需要的授权能力，不能自行绕开。

## 独立实施与兼容策略

- **019A：docs-only** 盘点现有 12 Tool 和 Java API，整理经过审查的 `operationId` JSON/YAML + Schema/权限模型，先写采购/库存/配制/服务耗料/分析的 SKILL.md 草稿和对话验证矩阵。无实际运行插件改动。
- **019B：runtime MVP** 先做 `erp_discover` + `erp_query` **只读**，对标 013 五个查询 Tool 的真实结果、权限与性能，验证“之前那家供应商”之类多步自主编排。保留旧 12 Tool 作为兼容基线；不直接废弃。通过后再开放通用 `erp_prepare`，仅无入账草稿。
- **015C** 单独处理企微 PDF 送达/回执重取与确认语句标点容错，不改变原生业务事务。
- **016/017** 首选通过目录 + Skills + 已有 Java 网关能力接入配制/耗料/Excel，不为每类工作流程复制 N 套 OpenClaw Tool。
- **验收**：同一企微用户可组合查询/创建合法草稿；越权 operationId、租户/仓库数据泄露、写型 operationId 走 query、非可信确认、恶意提示注入/上传文件伪指令全部拒绝；Token/成本/延迟追踪但不把真实客户资料写进外部证据。

## 必须坚持的边界

- 019A 与 015B 代码 PR **两个独立分支**，019A 不触碰 F: 真运行态/采购过账/插件注册。
- 不把原 jshERP Swagger 的所有接口直接交给模型。审定 API 子集而非通用 HTTP 客户端。
- SOP 文案变动必须版本化；涉及业务权限的变更只能在 ERP 服务端注册并测试。
- OpenClaw 可自行调用多次只读/草稿 Tool；但库存与审计最终状态只依赖 ERP 原生事务结果。
