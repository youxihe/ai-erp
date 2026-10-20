# AIERP-012 · ERP Tool Adapter + 企微绑定（等 AIERP-011 验收通过后）

- **状态**：PLANNED / BLOCKED_BY AIERP-011
- **目标**：在企微自然语言查询 jshERP 的实时库存，账号绑定/切换，权限隔离；再扩采购草稿，绝不让 OpenClaw 用共享管理员账号审单。
- **核心接口（待设计 Review）**：`binding.issue` / `binding.claim` / `binding.switch` / `stock.query` / `report.summary` / `purchase.createDraft` / `draft.confirm`。
- **绑定建议**：企微私聊“绑定ERP”获得一次性短码，用户登录已有 ERP 页面输入完成绑定；服务端绑定 `corpId + wecomUserId + tenantId + erpUserId`，短码 5-10 分钟、一次性，支持解绑与切换。**机器人不能接收 ERP 明文账号密码，也不能把 ERP 密码交给模型。**
- **授权底线**：当前 `AierpGatewayService` 依赖原生 `X-Access-Token` 用户身份。需安全的服务端授权委托/短期 token 代理，禁止用一份演示管理员 Token 代表所有企微用户。ERP 后端仍校验实际身份、租户和业务按钮权限。
- **模型工具底线**：Agent 仅提出查询/草稿工具调用；服务器硬性阻断未获用户显式确认的过账动作。外部企微文字、上传的 Excel 均是不可信输入，不能改变服务器许可列表。
- **渠道限制**：第一期仅私聊允许业务写操作，群聊默认拒绝；数据仅来自真实 ERP 工具，不以规则演示假装已经调用工具。
- **输出**：一张真实库存查询、两位不同权限用户的隔离测试、一次待确认草稿、拒绝越权/重复确认的测试证据。由 ChatGPT 另行 Release 后执行。
