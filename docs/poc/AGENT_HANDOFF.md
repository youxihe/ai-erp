# AI-ERP Cursor Agent · AIERP-009 简短交接

**范围严格限定 `youxihe/ai-erp`。** 已合并 AIERP-001/#3、003/#5、002/#7、005/#8、004/#10、008/#12。

**现状**：PC Demo v1 已具备三个真实业务流程（采购、配制、耗料），AI 助手明确标识 RULE_DEMO。真实 ERP API、Excel 过账/审计、权限/并发已经验证；**本轮不允许重构原生交易网关**。

**当前可认领**：从最新 `origin/master` 建 `feat/aierp-009-demo-polish`，按 `docs/poc/queue/AIERP-009.md` 做**一次小范围 UI/便携性收口**：
- PC：入账后行级状态“已审核”，避免还显示“待确认”；减少 0 库存无关卡片及单据拼接乱码，保持真实数据；
- H5：修复遮罩/菜单压住业务区，390×844 真实点击下载、上传、预览、确认区域，重新截图。
- 开发工具：相对路径装载 ExcelJS，原生启动说明能在正确项目目录使用。
- 重点是用户体验，不做大模型、企微、OpenClaw。

记录调整前后的 PC/H5 截图和最小回归测试。不要重复制造很多真实采购单据；验证需有新单号或使用只读截图。小问题放技术债；完工 push、`READY_FOR_REVIEW`；ChatGPT 创建 PR/Review/merge，Cursor 不合并。
