# AI-ERP 专用 Cursor Agent · Demo-first 夜间交接

> 只操作 `youxihe/ai-erp`，绝不可操作或借用 ZTO HR 代码、配置、数据库或任务队列。

## 当前已完成
- AIERP-001 PR #3（本地真实 jshERP Docker）
- AIERP-003 PR #5（真实网关；merge `d0bcb9f`），测试 34/34 PASS。

## 当前无需再问用户即可执行的队列
- **#1 AIERP-002**：Excel 下载/上传/行级预览/明确人工确认/真实过账；
- **#2 AIERP-005**：登录后的 PC/H5 演示工作台、真实库存与 Excel 流程 UI；
- **#3 AIERP-004**：自然语言 Agent + 工具调用，LLM 可选、没有 Key 使用明确标注的规则演示；
- **AIERP-008**：待上述任务合并后再做端到端集成。

**工作纪律**：一次开发一项；每项从最新 `origin/master` 建独立分支；完成、测试、push、`READY_FOR_REVIEW` 后自动开始下一项，不要因为 GitHub CLI 未登录、PR 还没有创建或 ChatGPT 未合并而停工；允许最多 3 条未合并的实现分支。**绝不自行 merge**。三项不改同一块主要文件：002 Java Excel、005 jshERP-web、004 Agent 服务。

每个任务优先交付能点通的“纵切”，不影响演示的微小问题写 `docs/poc/TECH_DEBT.md`。不要反复过度 Review 底层网关，不要反复运行会改变库存的破坏性基线，除非测试必需且能说明影响。

若无法创建 PR，把 push 的分支名、HEAD SHA、完整本地测试结果告知用户，ChatGPT 可从 GitHub 创建 PR。Cursor 自己继续下一条队列即可。

**运行环境**：本机 Docker 专属 MySQL 127.0.0.1:13306、Redis 127.0.0.1:16379、Boot 127.0.0.1:9999，jshERP-web localhost:3000；其他资源不得复用。只在本地演示使用默认账号，不对局域网/公网开放。

详见 `docs/poc/QUEUE.md`、`docs/poc/DEMO_CONTRACT.md` 和对应任务单。
