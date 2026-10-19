# AIERP-003 · jshERP 真实业务网关

- **状态**：BLOCKED（等待 AIERP-001）  **Owner**：Cursor-ERP
- 不改原生进销存核心优先；新增符合身份/租户/仓库限制的受控业务 Service 或 API。
- 模块能力：`stock.query`、`purchase.createDraft`、`mix.createDraft`、`service.createDraft`、`draft.confirm`、`report.summary`。
- 源码参考：`PurchaseInModal.vue` 映射 `入库/采购`；`AssembleModal.vue` 映射 `其它/组装单` 且 `mType`；`OtherOutModal.vue` 映射 `出库/其它`。
- 必须在真实环境核实 jshERP 对单据状态/审核/库存变更及事务回滚的语义，按原生链路实现，不能用 SQL UPDATE 库存。
- 每个写操作：草稿解析→主数据和单位映射→库存/权限校验→用户确认→唯一幂等键→正式单据→返回单据号与前后余额。
- 覆盖重复提交、库存不足、无权限、跨租户、非法单位、组装部分失败、并发风险。
- 交付 `[AIERP-003]` PR + 后端测试；只有实际过账证据才标 PASS。