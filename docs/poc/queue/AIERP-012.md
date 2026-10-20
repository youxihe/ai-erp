# AIERP-012A · 企业微信已验证身份 → ERP 授权绑定 → 只读库存查询

- **状态**：DONE / PR #19 MERGED（`cc3bd0e`；17/17 自动化通过，真实企微单账号库存已验证，双真实用户隔离 UAT NOT_VERIFIED）
- **仓库**：`youxihe/ai-erp`，**分支**：`feat/aierp-012a-wecom-readonly-stock`，从最新 `origin/master` 建。
- **依赖**：AIERP-011 已在 PR #17 Merge。OpenClaw 本机采用 Windows native `F:\aierp-openclaw`，DeepSeek V4 Flash 与官方 WeCom Bot WebSocket 已工作；已有 jshERP Docker 后端及网关。
- **本阶段唯一目标**：在企微私聊“绑定 ERP”→ 用户在已登录的 ERP PC 网页输入/核验短码 → 用户说“查表面活性剂库存”→ 返回**该用户有权限看到的真实 ERP 库存、仓库、物料中文名称、编码和单位**。
- **禁区**：不能调用 `purchase/draft`、`mix/draft`、`service/draft`、`draft/confirm`、`excel/confirm`；不能把当前真实成功的 OpenClaw 配置覆盖、重新安装或放开 shell/SQL/浏览器工具。

## P0-1 设计与信任链（先做一页 ADR，再最小实现）

1. 读取本机 `F:\aierp-openclaw\state\openclaw.json`（仅本机），检查已安装版本的官方 WeCom Channel / OpenClaw Plugin SDK **实际可得的可信事件上下文**。企微身份必须来自插件验证过的消息来源，不能让 LLM 自填 `wecomUserId`、`tenantId`、`erpUserId`、`X-Access-Token` 等参数。
2. 注册**专用只读 ERP 工具**，优先参考已安装 OpenClaw 的 `api.registerTool(...)` / `defineToolPlugin` 接口；只允许工具名 `erp_bind_start`、`erp_stock_query`、`erp_binding_status`、`erp_unbind` 等最小能力。不要在 `tools.alsoAllow` 中直接允许官方 `wecom-openclaw-plugin` 的**全部**企业工具。与模型无关的身份绑定协议由 adapter/ERP 受信代码执行。
3. **如果 SDK 工具上下文无法可靠取得可信发送者身份或不能绑定本会话**：如实产出 `BLOCKED_IDENTITY_CONTEXT` + 最小可验证方案，不能临时硬编码企微人员 ID 或统一使用 ERP 管理员账号“假装多用户绑定”。
4. `OpenClaw` 只知道当前企微渠道身份与工具结果；**不读取 ERP MySQL、不拥有 ERP 用户密码、不开放通用 HTTP/SQL 执行工具**。接口调用优先 `127.0.0.1:9999/jshERP-boot` （由进程内适配器访问），禁止访问 HR 或用户其他服务。实际 ERP 后端通过单独身份授权控制，不能只靠 MD 提示词。

## P0-2 企微用户与 ERP 登录账号绑定

1. 私聊用户发送“绑定ERP”后，由专用工具生成短期（建议 5 分钟）、一次性随机高熵绑定凭据；聊天只显示可安全输入的绑定码或一次性地址，绝不索取 ERP 密码。
2. 用户在**已经登录的** `http://localhost:3002` jshERP 页面（可在 AI 工作台增加轻量“绑定企业微信”入口）输入绑定码；**ERP 服务端读取当前登录用户**并记录 `channel + account/bot ID + 企微可信用户 ID + ERP tenantId + erpUserId + timestamp/status`。
3. 绑定码服务端保存哈希，原子消费、速率限制、防暴力枚举与重放；过期不可用；不能跨企微用户、企业/机器人或跨 ERP 租户盗用。一个企微身份可解绑/重绑；多租户切换第一期可以要求解绑并重新登录绑定，**不必同时支持多账号切换**。
4. 不能要求用户把 ERP 用户名/明文密码发到聊天框；不要以 OpenClaw 本地 Agent 的管理员 ERP token 查询所有租户。
5. `ERP Gateway` 当前依赖 `userService.getCurrentUser()` / `X-Access-Token`。需要专用**只读身份委托**：ERP 服务端按绑定结果与有效授权确定身份，并重复检查租户、仓库、角色权限；不要直接把企微 userId 当作已登录 ERP 用户，也不要将 ERP session token 交给大模型。可以选择签名短期授权调用或 ERP 后端内部只读执行服务，但写操作接口一律不可达。

## P0-3 只读库存查询

- 查询意图：“查表面活性剂库存”“原料仓里还有多少 RM-A001”；如缺仓库，AI 返回**该权限下**可见仓库的实际库存列表并说明是哪一仓。
- 先从可信 `stock.query` / ERP 服务侧复用主数据、租户/仓库权限，返回 `materialName, barCode, depotName, unit, currentStock, asOf`（有真实时间才能返回）。
- 未绑定：明确回复“请先绑定 ERP”；无该仓库权限：明确拒绝；未识别物料：请求补充名称/编码，而不是编造余额；ERP 不可达：说明暂时无法查询，不使用旧缓存当实时值。
- 企微消息展示纯文本/Markdown 即可；暂不做 H5 外网访问与复杂图表，也不更新企业微信全套开放权限。

## 测试门槛（需真实账号/真实结果）

1. 两个权限不同的 ERP 用户分别绑定两个**可信企微身份**，A 可查询授权仓库，B 不允许越权查询，不能通过消息中的“假装我是管理员”绕过。
2. 未绑定、绑定码过期/复用、换账号/解绑、伪造 tool userId/tenantId、跨租户和 ERP 不可用，全部有正确的拒绝/提示；日志不得泄露绑定码、Token、真实凭据。
3. **只读**回归：全过程无新增采购/组装/服务单据、无库存变化，不能通过 OpenClaw 工具触发审核。
4. 在企微真实私聊回复：物料**中文名称 + 编码 + 仓库 + 单位 + 实时库存**；用户能看懂来自 ERP 的真实数据。
5. 保持现有企微正常聊天、DeepSeek 正常、F: 原生 Gateway 可重启；改 `openclaw.json` / `AGENTS.md` 等先本机备份，并提交**脱敏模板与适配器源码**到本分支，绝不提交 `state/.env` / 会话。
6. 若缺第二个企微测试身份或 ERP 低权限测试账号，Cursor 先做好自动化隔离测试与可操作的人工验收步骤，**报告待外部测试的环节，不得标真人多用户 UAT PASS**。
7. 本轮不需要重跑会实际过账的 `demo-e2e.mjs`；提交只读测试脚本 `deploy/scripts/aierp-012a-readonly-flow.mjs` 或等价证据。

## 交接

- Cursor 编码、同步本机配置、运行，只在 `youxihe/ai-erp` 新分支提交后反馈 `READY_FOR_REVIEW`、HEAD、脱敏测试证据、企微实测状态；**不自行 merge**。
- 非阻断 UX/UI 问题记录技术债；采购草稿、实际确认、图表/H5、企微群聊及 OpenClaw 额外工具统一在 **AIERP-012B** 之后再讨论并由 ChatGPT 单独 Release。
- 最新官方参考：https://docs.openclaw.ai/zh-CN/plugins/sdk-overview 和 https://github.com/WecomTeam/wecom-openclaw-plugin ；**以本机装好的实际版本接口为准**，不要照抄不兼容 SDK。

## ChatGPT Round 2 完成记录

2026-10-21：PR #19 Review + Merge（`cc3bd0e`），公开默认 HMAC 密钥移除、服务端强校验和 nonce、禁用用户/租户即时授权拒绝均通过；实际企微截图显示已绑定 `jsh` 对原料仓和成品仓的实时库存列表。第二位不同角色 ERP 用户/企微真人 UAT 未完成，因此仍是本机 POC，不代表生产多用户验收。非阻断测试技术债：`aierp-012a-readonly-flow.mjs` 对原先 NULL 的租户到期时间没有完整原样恢复，不要把此脚本运行于正式环境。
