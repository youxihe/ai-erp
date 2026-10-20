# AI-ERP Cursor Agent · Demo-first 阶段完成

**独立仓库**：`youxihe/ai-erp`，严格禁止操作 HR/HCM 及其他项目资源。

AIERP-001、002、003、004、005、008、009 已完成 Review 并合并；最新收口为 **PR #14**（PC/H5 展示、脚本相对路径），merge `9caf6dd2`。目前没有自动释放的后续开发队列，**不要自动认领新模块，也不需要反复跑会改变真实库存的 E2E**。

当前本机 PC 演示脚本和使用说明：`docs/poc/08-demo-runbook.md`；主业务是采购 XLSX → 配制 → 服务耗料，AI 助手仍是 `RULE_DEMO`。

**下次用户要求实际演示时的最小核对**：`git pull --ff-only origin master` → 确认前后端仍是最新代码 → 只读检查真实库存、单据与助手 → 手机端检查 390/375 进入业务页、下载/上传和退出后其他 ERP 页的抽屉功能（这一步为 ChatGPT 附加的安全补丁做实机回归）；无需新过账单。

若用户之后指定真实 LLM、企业微信或产品化方向，等待 ChatGPT 先评审范围/依赖并释放明确任务，Cursor 仍不自行 Merge。
