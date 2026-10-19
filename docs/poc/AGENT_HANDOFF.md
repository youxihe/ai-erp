# AI-ERP 独立 Cursor Agent 启动说明

**项目：** `youxihe/ai-erp`。这是 PCB 清洗原料进销存 AI POC，**不是**任何 HR/HCM 系统。禁止跨项目读取代码、调用服务、借用 MySQL/Redis、复制配置、复制提示词或任务队列。

## 当前最新队列：AIERP-003 → AIERP-002

1. 仅在本仓库 `youxihe/ai-erp` 执行，拉取 `origin/master`，检查 `docs/poc/QUEUE.md`。
2. AIERP-001 已在 PR #3 合并，可复用本机已启动的独立 jshERP Docker 环境，不必重复开发部署任务。
3. 认领 `AIERP-003`，分支 `feat/aierp-003-erp-gateway`，完成真实 jshERP 受控业务接口与验收。
4. 单一实现 PR（WIP=1），完成后提交 `READY_FOR_REVIEW`，**不要自行 Merge**。
5. 等 ChatGPT 审查并合并 AIERP-003 后，认领 AIERP-002 完成 Excel 双向导入导出。

## 已有交付与后续

- 仓库 `poc/` 有可独立打开的本地交互演示；目前不是 ERP 真实数据，不能对客户称“已经实际入库”；
- AIERP-002 已列为下一任务，做 Excel 模板生成/解析/错误回执/确认（规格 `EXCEL_SPEC.md`）；
- AIERP-003 当前第一优先任务：ERP 受控 API；`AIERP-004` 做 AI Tools；`AIERP-005` 做 PC/H5；企微与 OpenClaw 暂不实施；
- 当前顺序已明确：003 → 002；004/005 等保持 BLOCKED，ChatGPT Review 后释放。

**提供给用户的项目资源请求标准：** 说明“本机已有资源可用”或“需要用户提供：MySQL/Redis 主机端口、数据库名/Redis db索引、账号权限、网络可达性、是否可用 Docker、测试环境访问要求”。不能在公共仓库或 PR 日志写密钥。