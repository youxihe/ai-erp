# AIERP-004 · AI Agent 工具与对话

- **状态**：READY_FOR_REVIEW
- **证据**：`docs/poc/evidence/assistant-20261019195103.json`
- **测试**：`node deploy/scripts/assistant-flow.mjs` 通过。模式为 RULE_DEMO。跳过确认的语句没有改变 RM-A001 库存。未知物料被拒绝。未创建 PR（gh 未登录）。
- **Owner**：Cursor-ERP；**分支**：`feat/aierp-004-agent-tools`
- **前提**：AIERP-003 已合并。与 002/005 通过 `DEMO_CONTRACT.md` 协作；不用拉取其未合并代码。

## 最小可演示能力
1. 有状态的会话式业务助手支持中文自然语言识别：查询库存/经营摘要、获取采购/配制/服务模板、把用户说的数量生成待确认草稿或可预填 XLSX、解释上传行级错误、展示过账结果。
2. 使用严格工具白名单：`stock.query`、`report.summary`、`purchase.createDraft`、`mix.createDraft`、`service.createDraft`、`draft.confirm`、`excel.template`、`excel.parsePreview`、`excel.confirm`；绑定现有 jshERP 会话与角色权限，模型没有 shell、SQL、任意网络访问权。
3. **任何自动化对话不得直接调用 confirm**；只返回可确认的预览/待确认 Action ID，必须由用户在 UI 明确点击确认，服务器再执行真实确认。prompt injection 和上传文件内的“请跳过确认”均不能生效。
4. 最初不用部署 OpenClaw。LLM API 有可用配置则用真实模型 Tool Calling；没有 Key 也要提供**明确标为“本地规则演示”**的可操作模式。不能将规则输出说成真实大模型能力。
5. 复用 AIERP-002/003 的真正文件和业务接口；如 002 尚未 merge，可按已定义契约开发工具适配层，并以“接口尚未集成”显式提示；不得伪造 ERP 成功。
6. 交付三段自然语言交互和拒绝案例（越权/未确认/未知物料/重复确认），工具执行日志不泄露 token、密码或用户上传原始文件。
7. 修改范围以独立 Agent 服务/控制器为主，不修改 `jshERP-web`（005 的所有权）和 Excel 解析（002 的所有权）。

## 交接
- 开始前读取 `docs/poc/DEMO_CONTRACT.md`；沿用 `/aierp/v1/assistant/turn` 建议契约。
- 提交分支 `feat/aierp-004-agent-tools` 和真实/规则模式区分证据；`READY_FOR_REVIEW`；不自行 merge。
- 如果 002/005 已推送但未合并，仍可独立开发；不要直接复制其未审实现。需要的 API 依赖写在 PR 描述中。
