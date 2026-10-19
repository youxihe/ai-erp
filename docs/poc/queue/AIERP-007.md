# AIERP-007 · OpenClaw 对照与可插拔适配（后续）

- **状态**：BACKLOG / 未释放。当前不安装部署 OpenClaw。
- 对比轻量 LLM 工具代理 + 官方企微 SDK vs OpenClaw 官方企微插件：多轮处理 Excel、对话上下文、文件输出、技能生态、运维成本。
- OpenClaw 如接入，仅调用已授权的 ERP 业务 API，不可直接连接 MySQL、访问 Shell 或写文件系统；Gateway 共享 token 不能代替员工身份。
- 提供推荐/不推荐结论、部署隔离、权限策略和回滚方案，再等用户决策。
- 需 ChatGPT 明确释放，Cursor 暂不认领。