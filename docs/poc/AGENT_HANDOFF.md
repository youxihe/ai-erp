# AI-ERP Cursor Agent · 当前两条流水线

## 1. 优先收口 AIERP-015B PR #27（业务代码，原分支）

PR：https://github.com/youxihe/ai-erp/pull/27，当前 HEAD `5427e3edd0f5`。用户真人企微确认 #111 已完成原生采购入库 `GW-PURCHASE-111`，库存 160.7→170.7 L，文字回执成功。后端确认事务正确，**勿重写**。

请读取 PR #27 ChatGPT 最新 Review 评论，**只修复**：
- `confirmUiAs` 用 ERP Session 确认时不能依旧绑定记录自我证明，要与当前 ACTIVE 的企微绑定及 binding_version 重新核对，过期/解绑/换绑旧草稿不允许确认。
- `loadPdfBytes` 重验 ERP 用户/租户/原生单据、角色和仓库权限，撤权后旧 receiptId 不可下载。
- 必要测试（不重跑真实入库/不碰 #106/#111），推送 REVIEW_FIX_PUSHED，新 HEAD，不自行 Merge。

P1 单列：企微 PDF 附件未验证、`确认采购：111` 标点兼容、iText 许可证审核。015C 另立任务。

## 2. 019A docs-only（可在上述修复分支 Push 后独立开始）

从最新 `origin/master` 建 `product/aierp-019a-capability-catalog-skills`。阅读：
- `docs/poc/AGENT_CAPABILITY_ARCHITECTURE.md`
- `docs/poc/queue/AIERP-019A.md`
- `docs/poc/queue/AIERP-019B.md`
- 既有 `AierpWecomController`、`AierpGatewayController`、`aierp-erp-tools` 插件与 014D 确认 ADR

交付 versioned ERP operationId 能力目录（不只是文字 API 链接）、JSON Schema/权限/副作用标记、`AGENTS.md` 规则瘦身建议与场景 OpenClaw `SKILL.md` 草稿，详细支持采购/库存/配制/服务耗料/分析，通过产品设计 PR 单独 Review。能力目录**不等于开放所有 ERP HTTP API 给大模型**。

019A 绝不修改运行态 F: OpenClaw/原生采购代码；019B 实施待 ChatGPT Review 后 RELEASED。不要自行 Merge，不动任何 HR 项目。
