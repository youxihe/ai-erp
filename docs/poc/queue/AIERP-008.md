# AIERP-008 · 一体化 Demo 联调、真实浏览器验收及交付

- **状态**：READY_FOR_REVIEW
- **优先级**：P0 Demo Gate
- **Owner**：Cursor-ERP；**分支**：`feat/aierp-008-integrated-demo`（从最新 `origin/master` 建）
- **证据**：`docs/poc/evidence/demo-e2e-20261020014600.json`；截图 `docs/poc/screenshots/`；操作说明 `docs/poc/08-demo-runbook.md`
- **浏览器单据**：GW-PURCHASE-94 / GW-MIX-95 / GW-SERVICE-96；脚本单据 GW-PURCHASE-91 / GW-MIX-92 / GW-SERVICE-93
- **测试**：`node deploy/scripts/demo-e2e.mjs` 通过；`http://localhost:3002/dashboard/aierp` 已人工点通。未创建 PR（gh 未登录）。
- **关键约束**：只操作 `youxihe/ai-erp`，使用 AI-ERP 本地独立服务；严禁 HR 项目资源，Cursor 不自行合并。

## A. 第一阶段：整合到真正可点通的页面（先解决，不扩大功能）

1. 检查 `jshERP-web` 的 `/dashboard/aierp` 能在已登录会话访问；当前 URL 可为 `http://localhost:3002/dashboard/aierp`（实际端口以运行配置为准）。真实开发服务器、代理、`X-Access-Token`、下载 Blob、上传 Multipart、`/aierp/v1` 与 `/jshERP-boot/aierp/v1` 路径保持一致，不能前后端一条接口各用一个不工作的前缀。
2. 新增 Excel 和 Agent 后端均应在同一最新 `master` 构建部署，再完整页面操作；之前 Cursor 在本机混合运行的服务不等于已在合并代码上重新验证。
3. 工作台三场景真实下载/上传预览/人工确认/单据回显/回执下载实际点通。要验证表格中错误行不会入账、有效业务单按整单确认，并准确展示返回的部分成功/失败。
4. 前端确认按钮双击、响应丢失、重复上传不同批次号、同业务单号不同文件重试必须保证**不二次扣库存**；界面刷新后真实库存回显。避免重复确认造成 UI 假成功。
5. 助手区域真正接通 `/aierp/v1/assistant/turn`，使用当前登录 ERP 会话；标示“本地规则演示（RULE_DEMO）”，不再说 Excel 模板接口尚未合并；推荐模板 Action 能触发实际下载/跳转，但不自动过账。没有模型 Key 也要展示真实数据查询和流程引导。禁止声称已完成 LLM Tool Calling。
6. 尽量不改 ERP 原生 Service 层业务规则；只修复实际联调阻断问题。Excel 后端已有本地测试 10/10、助手 4/4、网关 34/34，无需无意义重复刷多次真实库存测试。

## B. 第二阶段：验收交付与截图

- **真实 PC 操作**：至少截图首屏真实库存、采购上传预览、人工确认成功含原生单号、配制/服务耗料结果、助手 RULE_DEMO 真实库存回答。
- **真实 H5 操作**：手机尺寸截图并验证基本可点击，页面不横向溢出、不反复新开浏览器页签。
- **端到端证据**：记录单据号、开始/结束库存、客户与原生 subType、仓库；另验证错误单位/未知物料/公式拒绝、无权用户确认拒绝、重复确认不重复入账。
- **一键启动与说明**：`docs/poc/08-demo-runbook.md` 给出本机启动/登录、预填样例 Excel、演示讲解脚本、恢复演示数据操作和已知限制；可提供 `deploy/scripts/demo-e2e.mjs` 但不能只靠脚本断言代替真实浏览器。
- **安全**：验证码原值恢复，监听仅 loopback，不要写入任何真实秘密；服务耗料不是销售额，配方只是虚构演示。
- **交付**：PR `[AIERP-008] integrated customer demo` + 真正浏览器验证记录 + 成功/失败证据。通知 ChatGPT `READY_FOR_REVIEW`；不得自行 merge。

## C. 非阻断技术债（记录，不要拖住演示）

- 上游原生 ERP 其他页面不共享 AI 网关库存行锁。
- 数据字典/Excel 表头别名和正式财务计价复杂度。
- RULE_DEMO 目前非真实 LLM，后续有模型 Key 再接工具调用；企微和 OpenClaw 均不在本次范围。

**验收终点：** 客户只需打开同一个已经登录的 PC 页面，即可从 Excel/对话入口走完采购→药水配制→服务耗料，所有成功单据和库存都是 jshERP 真实数据。
