# ADR · AIERP-013 企微只读业务查询工具包

**状态**：Proposed → Ready for Review  
**日期**：2026-10-21  
**前置**：AIERP-012A（可信企微身份、HMAC、绑定、库存只读）

## 背景

012A 仅支持绑定与库存。业务阶段需要企微直接查询物料、供应商/客户、采购/配制/耗料单据与受控经营摘要，且不得写库存。

## 决策

1. **身份不变**：工具仍只信 `ctx.messageChannel==='wecom'` + `ctx.requesterSenderId`；Java 侧 `resolveBoundActiveUser` 解析绑定并实时校验用户/租户启停。
2. **新增适配器只读路由**（HMAC + nonce，LogCostFilter 放行）：
   - `/material/search`、`/partner/search`、`/bill/search`、`/bill/detail`、`/report/query`
3. **功能权限**：物料→库存功能 246；供应商/采购单据/采购汇总→采购 33；组装→232；客户/服务单据/客户耗用汇总→服务 202。无功能权限 403。
4. **仓库权限**：单据列表/明细/报表仅纳入 `UserDepot` 授权仓库的行；跨仓单据对无权限用户不可见明细。
5. **单据语义**：`purchase`=入库/采购，`mix`=其它/组装单，`service`=出库/其它；显式排除销售收入，避免误表述。
6. **日期/行数上限**：跨度 ≤90 天；默认 10 行、最大 50。
7. **报表**：后端 SQL 聚合；`nature=REAL_ERP`；空区间返回 hint，禁止模型编造。
8. **OpenClaw**：扩展既有 `aierp-erp-tools`，保留 012A 四工具；结果继续写入 `details.summary`。
9. **不改**：`addDepotHeadAndDetail`、`draft.confirm`、Excel 确认事务；不注册任何写工具。

## 后果

- 双真实企微用户不同仓库权限 UAT 仍 `NOT_VERIFIED`。
- 服务耗料与「出库/其它」同型；若租户另有同 type/subType 非服务单据，后续 TECH_DEBT 再收窄。
- 015 写操作仍须等 014D Review。
