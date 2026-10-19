# AI-ERP POC · Demo-first Delivery Queue

> **唯一工作域**：`youxihe/ai-erp`；与 ZTO HR/HCM 等完全隔离：禁止读写其他仓库、环境、数据库、Redis、密钥和任务队列。

**目标（2026-10-20）**：尽快向客户演示“AI 发/收 Excel → 解析预览 → 人工确认 → jshERP 原生单据/审核 → 真实库存变化”；同时提供登录后的 PC/H5 看板和对话入口。演示效果优先；非阻断细节集中登记到 `docs/poc/TECH_DEBT.md`，不要反复打磨基础网关。

## 当前队列

| ID | 优先级 | 状态 | 可开始条件 | Owner/分支 |
|---|---|---|---|---|
| AIERP-001 | P0 | **DONE / PR #3 MERGED** | — | 本地 jshERP 基线 |
| AIERP-003 | P0 | **DONE / PR #5 MERGED** | — | ERP 真网关，merge `d0bcb9f` |
| AIERP-002 | P0 | **RELEASED / next_order #1** | 立即 | `feat/aierp-002-excel-workflow` |
| AIERP-005 | P0 | **RELEASED / next_order #2** | 002 分支已 push（无需等合并） | `feat/aierp-005-demo-workbench` |
| AIERP-004 | P0 | **RELEASED / next_order #3** | 005 分支已 push（无需等合并） | `feat/aierp-004-agent-tools` |
| AIERP-008 | P1 | **PLANNED / integration gate** | 002/004/005 合并后 | Demo 一键启动与全链路验收 |
| AIERP-006 | P2 | BACKLOG | Demo 已完成且用户提供企微资源 | 企业微信 |
| AIERP-007 | P2 | BACKLOG | 根据 Demo 反馈再评估 | OpenClaw |

## 夜间执行机制（一个 Cursor 智能体，最多 3 个独立实现 PR）

1. 一次只**主动编码一项**，按 `next_order`：002 → 005 → 004。每个任务都从最新 `origin/master` 建**独立分支**，不要从另一条未合并功能分支派生，不要 cherry-pick 未 Review 的功能提交。
2. 每完成一项：本地测试、记录可复查证据 → push 分支 → 对应任务文档标 `READY_FOR_REVIEW` → 如 GitHub CLI 未认证，**不等待建 PR**；输出分支/HEAD/测试结果，自动进入下一项已 RELEASED 任务。
3. 允许最多 **3 个已推送待 Review 的实现分支**，避免“PR 未合并”导致整晚停工；这不是授权 Cursor 自行 merge。可以并行开 worktree，但同一智能体一次聚焦一项，不与 HR 工作区交叉。
4. 开始下一个独立任务前，先阅读 `docs/poc/DEMO_CONTRACT.md`，只修改本任务所有权下的文件，避免冲突：
   - 002：Excel 后端/文件收发/下载回执、独立测试、文档（Java 业务层、新 Controller）
   - 005：`jshERP-web` 的登录后演示工作台、真实数据、预览与按钮交互、前端截图（尽量不动 Java）
   - 004：独立 Agent/工具服务和严格白名单意图适配（`gateway/agent` 等），LLM 可选（不动 005 页面、不重写 002 Excel）
5. 控制面不因子分支 CLAIMED 就自行改 `master`：ChatGPT 负责审查、合并和下一次集成任务释放；Cursor 不自行 merge，也不自行接入企微/OpenClaw。
6. **只有这些安全/业务边界阻断 PASS**：越权/跨租户、未经确认过账、重复确认多次扣库存、实际金额或库存方向错误、演示关键路径 500/404/无法上传或确认。普通布局、性能、样式、细微字段问题写技术债；优先做能演示的垂直切片。
7. 遇阻塞不闲置：先完成不依赖外部资源的部分，写 `BLOCKED_EXTERNAL_RESOURCE` 和需要用户提供的最小清单；不要自造凭据、调用其他项目资源。不要为了重复证明网关而反复运行会实际改库存的完整基线。
8. 如果存在本地 Cursor 任务巡检，可用 10 分钟巡检**仅限本仓库本队列**，确保同一时刻一个巡检实例；没有巡检能力时，按上述分支接力执行，不要创建无限后台进程。

## 必须展示的三段业务

A. 采购：用户说“给我采购入库表” → 下载 XLSX；填写/上传 → 行级预览 → 人工确认 → 真采购入库审核、库存 +N、单据号、回执。

B. 配制：用户说“按这个配制表做药水” → 下载预填 XLSX → 上传解析，原料子件归组 → 人工确认 → 真组装单、原料减少成品增加；配比仅为虚构演示数据。

C. 服务耗料：用户上传服务记录 → 匹配真实客户和成品仓 → 预览 → 人工确认 → `出库/其它` 扣减清洗液，不虚构销售收入；可从库存/单据查看结果。

## 验收护栏

- 页面实时业务数据只能来自真实 jshERP API，不能把 localStorage 模拟余额作为真库存。
- 无论对话还是 Excel：草稿、预览和模拟/规则解析不能冒充已经过账；每次正式确认必须由有权限用户操作。
- 单次演示确认对应一个不可重复入账的幂等业务键；服务端要隔离租户与仓库。
- 企微和 OpenClaw 不在当前夜间开发范围，用户暂不需要配置。

**最新控制面**：2026-10-20，AIERP-003 PR #5 合并 `d0bcb9f4c8b7db879066c19e7472f810e13fb79f`；Demo-first 协作改为“已推送待 Review 的独立分支允许继续下一棒”。
