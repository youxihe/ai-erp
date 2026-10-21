# AI-ERP Cursor Agent · 当前两条流水线

## 1. 优先收口 AIERP-015B PR #27（业务代码，原分支）

PR：https://github.com/youxihe/ai-erp/pull/27，当前 HEAD `5427e3edd0f5`。用户真人企微确认 #111 已完成原生采购入库 `GW-PURCHASE-111`，库存 160.7→170.7 L，文字回执成功。后端确认事务正确，**勿重写**。

请读取 PR #27 ChatGPT 最新 Review 评论，**只修复**：
- `confirmUiAs` 用 ERP Session 确认时不能依旧绑定记录自我证明，要与当前 ACTIVE 的企微绑定及 binding_version 重新核对，过期/解绑/换绑旧草稿不允许确认。
- `loadPdfBytes` 重验 ERP 用户/租户/原生单据、角色和仓库权限，撤权后旧 receiptId 不可下载。
- 必要测试（不重跑真实入库/不碰 #106/#111），推送 REVIEW_FIX_PUSHED，新 HEAD，不自行 Merge。

P1 单列：企微 PDF 附件未验证、`确认采购：111` 标点兼容、iText 许可证审核。015C 另立任务。

## 2. AIERP-017A · 企微 Excel 文件发送/接收及无过账预览（CODE，核心 Demo）

015B #27 授权安全修复 Push 后，从**最新 master 独立**建 `feat/aierp-017a-wecom-xlsx-inbound-preview`（不要继承 #27 未合并过账代码），完整阅读 `docs/poc/queue/AIERP-017A.md` 与 `docs/poc/EXCEL_BATCH_DEMO_ACCEPTANCE.md`。

第一期真正演示：“给我批量采购 Excel 模板” → 机器人发可下载编辑的 .xlsx 文件 → 企微中发回填写好的 XLSX → 后端归属到可信 sender/ERP 用户并返回逐业务单分组的可读预览/错误清单。库存及已审核单据零变化，**绝不将现有 `excel.confirm` 暴露给 Agent**。现在已有 PURCHASE/MIX/SERVICE 模板/预览；SALE/INITIAL 当前仅模板不能确认，必须如实说明。优先先打通采购附件来回，再验证配制和服务。

文件收发先看当前官方 `@wecom/wecom-openclaw-plugin` 具体版本入口，不让模型获得任意文件/SQL/shell 的访问能力；请求仍按 012A 绑定 actor 和仓库/租户权限。更新 F: 插件前先备份，不重装。提交 no-post 证据和真人企微文件来回 UAT，READY_FOR_REVIEW、不自行合并。017B/017C 仍 PLANNED。

## 3. 019A docs-only（允许与 017A 并行；与业务代码分支隔离）

从最新 `origin/master` 建 `product/aierp-019a-capability-catalog-skills`。阅读：
- `docs/poc/AGENT_CAPABILITY_ARCHITECTURE.md`
- `docs/poc/queue/AIERP-019A.md`
- `docs/poc/queue/AIERP-019B.md`
- 既有 `AierpWecomController`、`AierpGatewayController`、`aierp-erp-tools` 插件与 014D 确认 ADR

交付 versioned ERP operationId 能力目录（不只是文字 API 链接）、JSON Schema/权限/副作用标记、`AGENTS.md` 规则瘦身建议与场景 OpenClaw `SKILL.md` 草稿，详细支持采购/库存/配制/服务耗料/分析，通过产品设计 PR 单独 Review。能力目录**不等于开放所有 ERP HTTP API 给大模型**。

019A 绝不修改运行态 F: OpenClaw/原生采购代码；019B 实施待 ChatGPT Review 后 RELEASED。不要自行 Merge，不动任何 HR 项目。

017A 是客户演示 P0；019A 设计可由独立产品 Agent 同时推进，若只有一个 Cursor Agent，优先保证 017A 真实企微文件体验后再做 019A。暂不释放 019B 通用 Gateway Runtime，避免和 Excel 文件链路争抢开发资源。
