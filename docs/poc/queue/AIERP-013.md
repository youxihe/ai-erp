# AIERP-013 · 企微 Agent 真实业务查询工具包

- **状态**：RELEASED / next_order #1
- **Owner**：Cursor-ERP；分支 `feat/aierp-013-business-query-tools`，基于最新 `origin/master`。
- **工作前提**：PR #19 已合并；已配置 F: Windows native OpenClaw 的 `aierp-erp-tools` 和可信 `requesterSenderId` 绑定逻辑。**绝不重装/升级 OpenClaw**。
- **目标**：让用户可以真正从企微完成物料、客户/供应商、原生单据、经营摘要的多种**只读查询**，而非只查一个实时库存；仍不能过账或创建单据。

## P0 · 第一纵切（应当最快可验收）

1. `erp_material_search`：中文名称、编码、单位、分类、启停用；如候选同名/模糊，返回多个候选并提示用户选码；不直接读取其他租户。
2. `erp_partner_search`：按 `supplier|customer` 显示 ERP 的真实主数据、名称和编码（如有），严格租户及对应功能权限；隐藏不需要的电话、地址、成本等敏感列。
3. `erp_bill_search`：用户说“最近 5 张采购入库单”“昨天服务耗料”，按类型、日期、状态、客户/供应商查询，服务器参数化 SQL/Service、权限及租户过滤，返回中文类型、编号、业务时间、状态。**不要把采购、组装、耗料数据误写为销售收入**。
4. `erp_bill_detail`：用户问“看 GW-PURCHASE-94 明细”，需从后端按**原生单据+明细**验证 tenant/用户授权后返回行信息，绝不只凭单号 ID 返回任意租户的数据。
5. `erp_report_query` 最小纵切：例如“近七天采购入库汇总”“按客户统计服务药水耗用”；聚合必须在后端执行，并精确区分业务时间/财务金额/货品数量和审核状态；如果源数据/权限不全，返回说明而不是猜数字。

## 技术验收

- 所有工具从 `ctx.messageChannel==='wecom'` + **可信** `ctx.requesterSenderId` 取身份，禁止模型提供 `wecomUserId/erpUserId/tenantId/token`。
- 复用 012A 的 HMAC + nonce + 绑定映射 + `assertActiveUserAndTenant`；Java 单一只读服务封装业务查询，显式鉴别 ERP 角色功能和仓库数据权限。**只读仍可能泄露客户数据**，不认为能查库存就有权读全部供应商、单据/金额。
- 查询日期必须有上限（例如 90 天）、行数有上限（例如默认 10、最大 50），无授权时报 403，不允许模型拼 SQL/传原生表名、任意筛选表达式。
- 工具结果包含明确 `details.summary`、结构化 rows/type/date/total/nature，在企微默认短摘要；超过渠道文本限制时截断并提示缩小条件；不得把 ERP 错误堆栈或隐私原始数据传给模型。
- 优先只读接入原有 `AierpGatewayService.summary`、`jsh_depot_head` / 明细及主数据 Service，不改变 `addDepotHeadAndDetail`、`draft.confirm`、Excel 确认事务。
- 简单查询可以按仓库分组并隐藏跨仓零库存噪声；原本 012A 用户的查询仍兼容，不移除已可用工具。
- 仅在本机更新脱敏 `openclaw.example.json` 和工作区 `AGENTS.md` 以及实际 F: 运行配置，按当前管理脚本备份后同步，重启/探针及既有企微消息不可中断。

## 必须覆盖的场景

1. 企微直接查询物料、供应商/客户、最近采购单、组装配制单、服务耗料单、指定单据明细、真实经营摘要；要有*实际数据*与 Java 后台交叉核对。
2. 未绑定/无相应功能权限/禁止仓库/跨租户/停用用户/企微身份伪造、非法单号、超大日期范围全部拒绝或降级。
3. 源为空的统计返回“该区间暂无已审核数据”，不编造金额，报告中用户只见真实能看的数据。
4. 自动化 `node deploy/scripts/aierp-013-query-flow.mjs` 或等价无过账验收，输出脱敏 JSON；用户真人 2 身份/低权限 UAT 如仍缺，明确 `NOT_VERIFIED`。
5. 只允许注册新增 read-only tools，无 `erp_draft_confirm` / `excel.confirm` / 任意写入工具；不得为验证报表反复生成采购/配制/耗料单据。

## 排期与接力

- **先用最少改动打通物料与单据查询两条 P0 纵切**，再扩大供应商/客户和报表；不能因为报表复杂度延误全部功能。
- 完成 commit、证据、push、任务状态 `READY_FOR_REVIEW`，即使 GitHub CLI 未授权，也可直接开始 **AIERP-014D 的独立 docs-only 设计分支**；不等待 013 merge，但 Cursor 不自行 Merge。
- 非阻断字段/格式问题写 `TECH_DEBT.md`；真正越权/跨租户/用户权限失效属于 P0。
