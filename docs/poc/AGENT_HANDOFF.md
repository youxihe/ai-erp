# AI-ERP 独立 Cursor Agent 启动说明

**项目：** `youxihe/ai-erp`。这是 PCB 清洗原料进销存 AI POC，**不是**任何 HR/HCM 系统。禁止跨项目读取代码、调用服务、借用 MySQL/Redis、复制配置、复制提示词或任务队列。

## 当前只做第一棒：AIERP-001

1. 切换本仓库并拉取 `origin/master`，检查 `docs/poc/QUEUE.md` 和 `docs/poc/queue/AIERP-001.md`，确保状态 `RELEASED`；
2. 盘点机器环境（JDK 8、Maven、Node 20、MySQL 8、Redis 6 等）、仓库原版部署方式、SQL 初始化脚本；
3. 优先使 **原生 jshERP** 本地完整运行（后端、前端、数据库、Redis）；原本 `poc/index.html` 的浏览器模拟仅作辅助，不算完成任务；
4. 逐个验证：采购入库、组装单、其它出库、库存查询、审核影响库存；
5. 生成可重复执行的少量演示数据和完整部署文档；遇到 MySQL/Redis 缺失时向用户明确列出最小资源请求，**不要自行替用户猜测密码/服务器**；
6. 在新分支创建一个 `[AIERP-001]` PR，附启动命令、URL、测试截图/日志摘要、库存前后数字、风险和阻塞；**不要自行 merge**。

建议分支 `feat/aierp-001-local-bootstrap`，PR base `master`。必须先有真实运行证据再声明完成。

## 已有交付与后续

- 仓库 `poc/` 有可独立打开的本地交互演示；目前不是 ERP 真实数据，不能对客户称“已经实际入库”；
- 后续 `AIERP-002` 做 Excel 模板生成/解析/错误回执/确认（规格 `EXCEL_SPEC.md`）；
- `AIERP-003` 做 ERP 受控 API；`AIERP-004` 做 AI Tools；`AIERP-005` 做 PC/H5；企微与 OpenClaw 暂不实施；
- 队列尚未允许 Cursor 自动认领多个后续任务，由 ChatGPT Review 后释放。

**提供给用户的项目资源请求标准：** 说明“本机已有资源可用”或“需要用户提供：MySQL/Redis 主机端口、数据库名/Redis db索引、账号权限、网络可达性、是否可用 Docker、测试环境访问要求”。不能在公共仓库或 PR 日志写密钥。