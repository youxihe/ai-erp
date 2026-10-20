# AI-ERP POC · Demo-first Delivery Queue

> **唯一工作域**：`youxihe/ai-erp`，与所有 HR/HCM 及其它项目完全隔离。

## 2026-10-20 交付状态

| ID | 状态 | 说明 |
|---|---|---|
| AIERP-001 | **DONE / PR #3** | 独立本地 jshERP 基础环境 |
| AIERP-003 | **DONE / PR #5** | 真实原生采购、组装、服务耗料网关及权限幂等 |
| AIERP-002 | **DONE / PR #7** | XLSX 下载、解析、预览、人工确认、回执 |
| AIERP-005 | **DONE / PR #8** | PC/H5 演示工作台基础入口 |
| AIERP-004 | **DONE / PR #10** | 规则型助手与 ERP 实时库存查询 |
| AIERP-008 | **DONE / PR #12** | PC Demo 集成；17/17 脚本验收、本机浏览器三链路操作；**H5 尚未验收通过** |
| **AIERP-009** | **RELEASED / next_order #1** | **演示页面状态与布局收口、手机可操作性、脚本便携性；仅一轮小迭代** |
| AIERP-006 | BACKLOG | 企微接入，待用户确定渠道资源和需求 |
| AIERP-007 | BACKLOG | OpenClaw，后续按需要评估 |

## 本轮目标与边界

**当前唯一新任务**：`AIERP-009`，从最新 `origin/master` 建分支 `feat/aierp-009-demo-polish`。详情见 `docs/poc/queue/AIERP-009.md`。

**当前可演示能力：PC 端 Demo v1**，唯一受信数据源是 jshERP 真实业务 API。采购入库 → 药水组装配制 → 客户服务耗料，均按文件上传、预览、人工确认、原生审核、真实库存变化和下载回执展示。助手当前仅 `RULE_DEMO`，不得宣传为真实 LLM 或无需人工审核。

**审查标准：** 只针对页面真实可读/可点通、单据状态与结果表述一致、H5 上游遮罩/布局干扰、工具示例能在项目目录执行。**不修改核心库存、租户、权限、确认事务、ERP 栈**；小问题记 `docs/poc/TECH_DEBT.md`，不要重启大规模重构。

**原则**：只一个开发 PR，Cursor 本地测试和截图 → Push、`READY_FOR_REVIEW`；GitHub CLI 未登录可跳过建 PR，ChatGPT Review/merge。不要自行合并。不接入企微/OpenClaw，不从其他项目借资源。后台巡检如存在只留一个专属实例。
