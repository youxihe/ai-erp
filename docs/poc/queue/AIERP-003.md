# AIERP-003 · jshERP 真实业务网关

- **状态**：RELEASED / next_order #1（AIERP-001 已合并）  **Owner**：Cursor-ERP
- 不改原生进销存核心优先；新增符合身份/租户/仓库限制的受控业务 Service 或 API。
- 模块能力：`stock.query`、`purchase.createDraft`、`mix.createDraft`、`service.createDraft`、`draft.confirm`、`report.summary`。
- 源码参考：`PurchaseInModal.vue` 映射 `入库/采购`；`AssembleModal.vue` 映射 `其它/组装单` 且 `mType`；`OtherOutModal.vue` 映射 `出库/其它`。
- 必须在真实环境核实 jshERP 对单据状态/审核/库存变更及事务回滚的语义，按原生链路实现，不能用 SQL UPDATE 库存。
- 每个写操作：草稿解析→主数据和单位映射→库存/权限校验→用户确认→唯一幂等键→正式单据→返回单据号与前后余额。
- 覆盖重复提交、库存不足、无权限、跨租户、非法单位、组装部分失败、并发风险。
- 交付 `[AIERP-003]` PR + 后端测试；只有实际过账证据才标 PASS。
## 执行约束（ChatGPT Release 2026-10-20）
- 本任务先执行，先完成 ERP 后端业务网关再交付 Excel 批量过账；不铺开企微、OpenClaw 或全套重做 ERP。
- 优先完成接口契约与四类真实数据查询：`stock.query`、`purchase.createDraft`、`mix.createDraft`、`service.createDraft`、`draft.confirm`；如演示首版不做价格复杂计算，保持原生字段和默认审核规则。
- 服务耗料不应当作客户销售收入，服务单据要保存真实客户关联、物料与备注，避免看板统计混入销售额。
- 禁止重用 jsh 默认用户身份代表所有企微用户；网关必须按当前 jsh ERP 会话权限处理。
- 测试至少包含：草稿不扣库存、确认后库存改变、库存不足拒绝、重复 confirm 幂等、跨仓库或权限不足的拒绝。测试失败不得默默模拟 PASS。
- 单一实现 PR：`feat/aierp-003-erp-gateway`，PR 中标记 `READY_FOR_REVIEW`，由 ChatGPT 审核合并后才允许开始 AIERP-002。
