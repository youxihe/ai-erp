# AI-ERP Demo 联调契约 v1（002 / 004 / 005 共用）

> 本文是任务之间的稳定**协作契约**。具体实现如需变更路径/DTO，必须在提交 PR 时同步更新本文件或说明兼容策略，禁止各任务私下使用互不兼容的接口。以已合并 003 原生 ERP 网关为权威数据源。

## 一、体验形态

- 首选接入现有已登录 jshERP Vue `jshERP-web`，以原生 ERP 登录态调用后端。PC 优先兼容 H5；不要强制部署 OpenClaw 或企业微信。
- 实际业务信息只从 `/jshERP-boot/aierp/v1/...` 获取，不能沿用 `poc/index.html` 中 localStorage 的模拟库存；现有设计参考可复用，但“数据已过账”只能依赖真实网关响应。
- 每个业务都按 **模板/草稿 → 文件解析 → 行级预览 → 用户明确点击确认 → 原生单据审核 → 库存回显/回执** 展示。
- ERP 网关基座已存在（POST）：`/stock/query`、`/purchase/draft`、`/mix/draft`、`/service/draft`、`/draft/confirm`、`/report/summary`。具体参数以 `docs/poc/03-erp-gateway.md` 和源码为准。请求携带当前会话 `X-Access-Token`，不得长期写死 jsh/123456 身份。

## 二、002 · Excel 预期接口（由 002 落地；005 按此开发）

均在 `/jshERP-boot/aierp/v1` 下：
1. `GET /excel/template?scene=PURCHASE|MIX|SERVICE` → 真正 XLSX（二进制）下载；提供可选 `POST /excel/template` JSON 预填字段下载 XLSX；“物料期初、销售出库”可导出但若未接正式写入接口，应标“仅模板，不支持 AI 确认”。
2. `POST /excel/preview` → `multipart/form-data` 中 `file`，可选 `scene`；返回 `previewId`、`scene`、`status=PREVIEWED`、`records[]`、`rowErrors[]`、`summary`，每条记录包含 `businessKey`、`sourceSheet`、`sourceRows[]`、`normalized`、`errors[]`、`warnings[]`、`canConfirm`。
3. `POST /excel/confirm` JSON：`{previewId, selectedBusinessKeys?, idempotencyBatchKey}` → 校验当前 ERP 用户身份/权限，**只在用户已经点击确认后**通过 003 网关创建草稿并确认；返回 `batchId`、`results[]`（按业务单返回 `businessKey, status, billNumber, error, stockBefore?, stockAfter?`）。
4. `GET /excel/receipt?batchId=...` → XLSX 导入回执，供客户下载保存。批次应有防重复处理；相同业务键不得默默二次入账。

允许为实现简洁适度调整 URL/字段，但必须在 002 PR 文档中给出**实际 API、示例请求和成功响应**，并同步更新本契约，005/004 能据此对接。预览不创建正式单据；确认必须记录最终责任用户，禁止收到文件即过账。

## 三、004 · Agent 对话契约（005 可先按此展示）

预期 `POST /jshERP-boot/aierp/v1/assistant/turn`：
- 入参：`{conversationId?, message, context?:{previewId?,selectedBusinessKeys?}}`
- 出参：`{conversationId, mode:"LLM"|"RULE_DEMO", reply, intent, suggestedActions?:[{type,label,payload}], facts?, errors?}`
- `suggestedActions` 可以是库存查询、模板下载、生成草稿、导航到上传/预览页等**非过账动作**；即使文本为“直接帮我入库”，Agent 也必须返回确认动作由 UI 展示，不能自行执行 `draft.confirm` / `excel.confirm`。
- 如没有 LLM API Key，规则模式必须标示 `RULE_DEMO`。不要伪造模型调用，也不能伪造库存/已审核结果。开箱可演示自然语言“给我采购表”“查表面活性剂库存”“解释配制Excel错误”“今天服务消耗多少”。

实现者可选择 Java Agent Controller 或受控 Node 适配服务，但最终必须提供前端可达的**同源接口或已配置代理路径**和 ERP 当前会话透传。不要要求浏览器存储 ERP 用户密码或把 token 写入 URL。

## 四、005 · 前端边界

- 登录后在现有 `jshERP-web` 找到“AI 进销存演示”入口，页内有实际库存、最近业务单据、Excel 入口、AI 对话区域。
- API 在 002/004 分支未合并期间允许显示“待接入”，禁止 fake success，最终集成验收必须切到真实后端。
- UI 的业务状态必须分清：待上传 / 已解析 / 有错误 / 待确认 / 已入账 / 失败；确认按钮旁必须能看到业务单明细、数量及预计库存变化。
- 交付 PC 宽版优先，移动端适配；无需这轮企微 OAuth、付费模型账号或虚构的经营 BI。
- UI 修改主区域 `jshERP-web`，002 修改 Excel Java 服务与测试，004 修改独立 Agent 服务；不要互相覆盖未合并分支。

## 五、Demo 业务脚本

A 采购：`RM-A001` 在原料仓入库 2 L，展示审核前、审核后库存差 +2，下载采购入库回执。

B 配制：生成 `FG-101` 1 L；虚构配方示例消耗 A 0.6 L、B 0.1 L、C 0.3 L；归单/缺料行提示，确认后查两个仓库真实余额。

C 服务：客户“苏州精密电子”，从成品仓领用 `FG-101` 1 L，生成 `出库/其它`，关联客户 911，查看确认后余额 -1；**服务耗料不是销售收入**。

以上为软件功能演示，不是有效的化学工艺配比。每次重复演示前请核对真实库存，不采用硬编码初始余额。