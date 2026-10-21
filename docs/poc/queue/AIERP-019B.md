# AIERP-019B · 受控能力发现和自主组合查询的运行时 MVP

- **状态**：PLANNED / NOT RELEASED
- **依赖**：AIERP-019A 目录/SOP 通过产品架构 Review，且 PR #27 AIERP-015B 已完成合并。
- **目标**：在现有 12 个 ERP Tool 外增加 `erp_discover` / `erp_query` **两个受控通用只读工具**，让模型按 operationId 和 JSON Schema 自主发现并组合 ERP 已授权能力，优先验证“最近采购供应商”与查询+解释+草稿补录，保持旧查询/草稿工具兼容。
- **安全**：service-side allowlist + 绑定 ERP actor + role/warehouse/tenant live check + parameter schema + rate/limit/clock + audit，无模型传 URL、method、SQL、raw filter、userId 或 token；禁用 `COMMIT/HIGH_RISK` 操作。
- **验收**：现有库存、物料、往来单位、采购/配制/耗料历史、汇总读结果和 013 等价；跨租户/跨仓/停用用户拒绝；不存在配置外 operationId 或路径穿透；最少 5 个自由表达需组合多操作的真实企微对话通过。
- **限制**：OpenClaw native F: 配置备份、插件最小授权，不重装；不在这一任务实施 015B 的确认、PDF 或全量通用准备草稿（后续单独 Release）。
