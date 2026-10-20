# AI-ERP POC · Demo-first Delivery Queue

> **唯一工作域：** `youxihe/ai-erp`，与 ZTO HR/HCM 完全隔离。不得复用其他项目的数据库、Redis、凭据、服务器或代码。

## 2026-10-20 当前里程碑

| 任务 | 状态 | 交付 |
|---|---|---|
| AIERP-001 | **DONE / PR #3** | 独立本地 jshERP 基线 |
| AIERP-003 | **DONE / PR #5** | 原生采购/组装/耗料事务网关与并发保护 |
| AIERP-002 | **DONE / PR #7** | XLSX 下载、预览、人工确认、过账、回执；本地测试 10/10 |
| AIERP-005 | **DONE / PR #8** | 登录后 PC/H5 工作台，真实库存、单据、Excel 操作入口；待集成浏览器验收 |
| AIERP-004 | **DONE / PR #10** | ERP 实时库存对话与 RULE_DEMO 助手；本地测试 4/4（PR #9 文档冲突已关闭） |
| **AIERP-008** | **RELEASED / next_order #1** | **正式集成联调与本机客户 Demo 验收** |
| AIERP-006 | BACKLOG | 企业微信，等本机 Demo 稳定及用户资源 |
| AIERP-007 | BACKLOG | OpenClaw，可选后期评估 |

## 当前唯一自动认领任务：AIERP-008

在 `feat/aierp-008-integrated-demo` 从 **最新 `origin/master`** 开工。现在代码已全量合入，无需再用三条未合并的开发分支；禁止把旧 worktree、数据库或环境作为新权威源。完整验收见 `docs/poc/queue/AIERP-008.md`。

**演示核心三条闭环：**
1. 采购 XLSX：下载 → 上传 → 行级预览 → 人工点击确认 → 原生采购入库审核 → 实时原料库存 +N、真单号、回执。
2. 药水配制 XLSX：按配制单分组合并 → 预览 → 人工确认 → 真组装单，原料减、成品增，比例只是虚构软件演示。
3. 服务耗料 XLSX：真客户关联 → 人工确认 → 原生“出库/其它”，成品减；不计销售收入。

**AI 演示底线：** 有效操作结果来自真实 ERP；助手当前是 `RULE_DEMO` 而非真实大模型，不执行用户未确认的 `draft.confirm` 或 `excel.confirm`。整合后要去掉“Excel 待接入”等过时文案，保留模式标识。

**Review 阻断范围（Demo-first）：** 真实库存方向/金额/客户错误，未授权操作或跨租户，重复确认重复扣库存，文件预览即过账，主流程 404/500/无法操作，真实数据被模拟替代。其它次要问题登记 `docs/poc/TECH_DEBT.md`，尽快闭环，不再反复回修底层网关。

**工作流：** Cursor 本地做 008 → 保存实际 UI 和端到端证据 → 推送分支，`READY_FOR_REVIEW` → ChatGPT 创建 PR、Review、合并。Cursor 不自行 Merge；无 gh 登录也不阻塞 Push。当前不释放新的 ERP 模块或企微任务。不新建重复定时轮询，若已有本仓库 10 分钟巡检只保留一份。
