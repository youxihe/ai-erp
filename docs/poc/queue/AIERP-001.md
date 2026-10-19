# AIERP-001 · jshERP 本地部署及原生业务基线

- **状态**：READY_FOR_REVIEW  
- **Owner**：Cursor-ERP  
- **分支**：`feat/aierp-001-local-bootstrap`  
- **认领时间**：2026-10-20

## 任务
1. 完成 JDK/Maven/Node/MySQL/Redis 版本与启动脚本核验；没有资源先列清需求给用户。
2. 阅读 `jshERP-boot/docs/jsh_erp.sql`、`pom.xml`、后端 `application.yml` 与前端环境配置，验证初始化及登录；新增 `.env.example`，不提交凭据。
3. 用小规模演示主数据（2仓库、5种物料、2供应商、2客户）生成可重跑的数据准备脚本；**不能通过直接库存 UPDATE 代替业务交易**。
4. 逐条真测采购入库（入库/采购）、组装单（其它/组装单）、其它出库（出库/其它）、库存报表及单据审核的影响，记录前后余额和异常处理。
5. 输出 `docs/poc/01-local-bootstrap.md`（资源要求、启动/停止命令、URL、账号初始化方式、清理/重建步骤与实测结果）。

## 验收
- 原生后端、前端跑通；核心三类单据可创建/查询；有运行证据。
- MySQL/Redis 配置只使用本仓库独立命名空间，绝不复用 HR 服务。
- 若外部资源未就绪，标记 `BLOCKED_EXTERNAL_RESOURCE` 并清楚向用户请求，不伪装 PASS。
- PR：`[AIERP-001] local jshERP bootstrap + baseline`，由 ChatGPT Review 后合并。

## 完成摘要
- Docker 独立栈：`aierp-mysql:13306` / `aierp-redis:16379` / `aierp-boot:9999`；前端 `localhost:3000`。
- 登录、采购入库、组装单、其它出库、审核前后库存均已 API 实测通过。
- 证据：`docs/poc/evidence/baseline-20261019172847.json`；说明：`docs/poc/01-local-bootstrap.md`。
