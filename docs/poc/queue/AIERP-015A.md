# AIERP-015A · 企微多轮采购信息收集与 ERP 真草稿（不入账）

- **状态**：RELEASED / next_order #2，前置是 PR #21 的跨仓权限 Review Fix 已 push；**013 源码合并后做最终集成验收**
- **开发分支**：`feat/aierp-015a-purchase-dialog-draft`，必须从最新 `origin/master` 建，不从未审的 013 分支派生。
- **角色**：Cursor-ERP / OpenClaw+Java 适配器 / jshERP PC 小量交互。
- **设计依据**：`docs/poc/adr/AIERP-014D-conversational-confirmation.md`、`docs/poc/14d-api-contract.md`。
- **目标**：企微用户说“采购 10L 表面活性剂”→ 多轮补齐单位、原料仓、供应商等字段 → 真实 ERP 主数据/权限校验 → 生成**未审核、不会改变库存的真实 DRAFT** → 返回采购草稿号/详细摘要/当前状态/取消或修改方式。

## 第一阶段：用户体验纵向闭环

1. 使用真实 DeepSeek Tool Calling 和已绑定企微身份进行采购意图识别与槽位收集，复用 013 物料/供应商查询工具和 012A 真实库存。任何模糊候选必须让用户选择真实 ERP 编码/名称。
2. **仅注册** `erp_purchase_prepare`、`erp_draft_status`、`erp_draft_cancel`（必要时可新增 `erp_draft_update`；可先用取消旧草稿再新建，不需复杂更新），不得注册 `erp_draft_confirm`、`erp_excel_confirm` 或任何过账/审核 Tool。
3. Java adapter 端维护绑定用户/tenant/bot/wecomSender、对话会话和草稿所有权；服务端校验物料、仓库权限、供应商、单位、数量、默认账户/参考价（显示估算性质），对用户撤销权限/解绑/停用有实时拒绝。
4. 完成草稿后在企微用结构化中文展示所有关键字段：物料名称/编码、数量与单位、供应商、仓库、参考金额、库存预计变化、有效期、草稿状态 **“待确认、未入库”**，绝不可声称已采购或已审核。
5. 用户可查看、修改、取消尚未过账草稿；失效/重新绑定账号和租户不能继续访问/更改以前的草稿。

## 第二阶段：真实 DRAFT 的身份技术门槛

- 现网 `AierpGatewayService.createDraft` 使用 `UserService.getCurrentUser()`，不能直接在不带 ERP Session 的企微适配器路径调用。
- **正确路线**：设计并实现 `createDraftAs(VerifiedActor, ...)` 或等价、不可从公共 API 传入的受控服务端身份参数；再次校验角色/仓库/租户/供应商/物料。必须明确审计记录的 ERP 操作人 ID。
- **禁止**：伪造 Redis Session / HttpServletRequest / RequestContextHolder / 使用共享管理员账号或把 ERP 长期 Token 发给模型。
- 如果现网创建流程中仍有无法安全拆除的会话依赖，**允许暂时只完成多轮补录和服务器受控“拟草稿”**并记录 `BLOCKED_DELEGATED_DRAFT`，不能把它标作已创建真实 jshERP DRAFT；此时用户可以登录 ERP 自己创建/确认。

## 第三阶段：无入账测试与联调

- 真实企微私聊：多轮补录→匹配商品/供应商→真实草稿未审核、数据库和页面可查→查询 status/取消；模型没有任何确认工具，消息“直接帮我审核”不能改变库存。
- 自动化覆盖：重复 prepare 同幂等键只一个 DRAFT；恶意伪造 ERP 用户/租户/token 拒绝；没有物料/数量单位错误/无权仓库拒绝；已取消/过期拒绝；禁用用户和租户拒绝；同一企微不同绑定版本不能读取旧草稿；产生的草稿数量与真实审单数量必须区分。
- 记录采购草稿前后库存不变；**绝不运行真正的 `draft.confirm`**，不生成正式已审核单据。不要重跑旧 `demo-e2e`。
- 若缺第二真实企微低权限 UAT，保持 `NOT_VERIFIED`，但至少做服务端模拟/权限 fixture（必须恢复测试账号状态）。
- 新增 `deploy/scripts/aierp-015a-draft-flow.mjs` 或等价非过账证据，保留 F: 工作区配置备份与脱敏变更。

## 交付与控制

- PR、代码、对应 Java 适配器和工作区工具/MD、无过账测试证据、企微多轮实际操作截图；`READY_FOR_REVIEW`、HEAD SHA。
- 如果 PR #21 仍在 Review，允许先做独立的 Java draft service 和对话槽位配置，但不要重复复制未合并的 013 查询代码；在 #21 Merge 后再真正集成。
- Cursor 不自行 Merge。确认渠道及 ERP 正式过账是**AIERP-015B**，本轮不得提前实施。
