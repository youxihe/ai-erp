# AI-ERP Cursor Agent · AIERP-008 集成交接

**仓库**：`youxihe/ai-erp`，绝不跨用其他 HR/HCM 系统项目的代码、服务与凭据。

已经合入：
- AIERP-001 PR #3，AIERP-003 PR #5；
- AIERP-002 Excel PR #7：本地验证 10/10；
- AIERP-005 PC/H5 PR #8：原生前端真实库存/单据展示；
- AIERP-004 Agent PR #10：本地规则助手 4/4（原 PR #9 因文档冲突已关闭）。

**当前唯一任务**：拉取最新 `origin/master` → 阅读 `docs/poc/QUEUE.md` 和 `docs/poc/queue/AIERP-008.md` → 认领 `AIERP-008` → 从 master 新建 `feat/aierp-008-integrated-demo`。

这次只做真实浏览器端到端联调、PC/H5 页面操作、一键本机启动、客户演示讲解脚本和验收证据；不再拆开发三个功能模块。重点对齐 Excel/助手同源路径、上传/下载/确认、助手模式文案。**未合并的旧分支和本机混跑的 Java 包不是权威实现**。

需要真实走三条 Excel 业务与页面确认链路。测试会修改本机真实库存，使用新业务单号和当前库存快照，避免破坏稳定演示数据。不虚构数字/不发明 LLM 能力，不接企微/OpenClaw。

完成后 Push，反馈新 HEAD、真实演示截图/证据、测试结果和 `READY_FOR_REVIEW`，不要自行合并；若本机 gh 未登录，ChatGPT 可建 PR。小问题记 `docs/poc/TECH_DEBT.md`，避免阻断 Demo。
