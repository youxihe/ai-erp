# AI-ERP Cursor Agent · 015B 可信采购确认及 PDF 回执（2026-10-21）

**任务起点**：PR #24 AIERP-015A 已合并 `1a82abca`，企微真实草稿 #106 已出现（**不代表已入库**），OpenClaw F: Windows native 有 12 个工具，DeepSeek + WeCom WS 正常。25/25 单机非过账检查 PASS；双真实企微不同 ERP 仓库权限 UAT 仍 NOT_VERIFIED。

**当前唯一 RELEASED：AIERP-015B**。从最新 origin/master 开 `feat/aierp-015b-trusted-confirm-receipt`，阅读 `docs/poc/queue/AIERP-015B.md`、`docs/poc/15b-receipt-contract.md` 与已合并 `docs/poc/adr/AIERP-014D-conversational-confirmation.md`。

1. **P0 实际企微单聊确认**：官方 WeCom WS 入站原始消息经可信 Channel 验证，服务端保存挑战绑定草稿/用户/版本/业务 hash，一次性消费。用户可回复“确认采购106”，如只有唯一待确认草稿也可回复“确认”；必须基于原始消息/会话身份而不是 LLM 自报。若 Hook/SDK 不支持报告阻断，提供已登录 ERP PC/H5 真实身份确认，别假装已跑通企微直接确认。
2. **P0 真正过账**：审计 `AierpGatewayService.confirmInTx → postNativeBill → DepotHeadService.addDepotHeadAndDetail / batchSetStatus` 的 HTTP Session 依赖，以显式 actor 正确重用原生服务或走原生 ERP 登录确认。**禁止假 Session、共享管理员 Token**，禁止自造/修改库存。确认时重查授权仓库/审核按钮、供应商、价格、租户用户状态。重复消息/双击幂等返回同一原生单号，无第二次库存变化。
3. **P0 绑定版本**：取消/换绑/同秒重新绑定生成不同 generation 并即时拒绝旧草稿；引入单调 binding_version 或不可复用随机 generation 标识，迁移向前兼容旧只读草稿。
4. **P0 回执文本、P1 PDF 文件**：确认成功且原生单据状态已审核才能出具带单据号、时间、物料、供应商、仓库、实收数量、单价金额及实际入库变化的“采购入库业务回执”，**不是发票**。优先通过官方企微支持的文件消息把 PDF 发到私聊；若渠道限制，必须如实标记 `PDF_DELIVERY_NOT_VERIFIED` 并提供已登录 ERP 页面下载，不要把 PC 的 127.0.0.1 当手机可用链接。
5. 本机配置修改先备份 F:\aierp-openclaw 的真实插件、openclaw.json、MD，会话不清空；不会触及 ERP 外其他项目；不给 Agent shell/SQL/任意HTTP。
6. **先做无过账安全单测，再做隔离开发库专门测试草稿的有确认验收**，不得自动确认已有真实草稿 #106；实际企业微信由用户参与发“确认”，记录真实审核单据 ID、库存变化和 PDF 附件状态。不同企微/ERP 权限的真人双用户 UAT 继续如实标 `NOT_VERIFIED`。
7. Push `READY_FOR_REVIEW`（若卡信任入口用 `BLOCKED_TRUSTED_CONFIRM_EVENT`，若卡原生 actor 用 `BLOCKED_NATIVE_ACTOR`），报告 HEAD、测试和脱敏证据，Cursor 不自行 Merge。

仅当 015B 通过 ChatGPT Review 后，再把这一套服务端可信确认复用于后续的配制/服务耗料（016）。
