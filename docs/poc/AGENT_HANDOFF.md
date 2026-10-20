# AI-ERP Cursor Agent · 当前唯一任务：AIERP-012A

ChatGPT 已正式合并 AIERP-011 PR #17（`85e4676a`），企微 + DeepSeek 的真实对话基础完成。

- **现有 OpenClaw**：Windows native `F:\aierp-openclaw`，`%LOCALAPPDATA%\aierp-openclaw` junction，配置/密钥 `F:\aierp-openclaw\state\`，Gateway `127.0.0.1:18789`。**不要重新安装或迁回 Docker/WSL**，不要运行 `install` 或升级脚本。任何配置修改先备份。
- **现有 ERP**：本机独立 Docker jshERP；PC 工作台 `http://localhost:3002/dashboard/aierp`。
- **开始**：拉取最新 `origin/master` → 阅读 `docs/poc/queue/AIERP-012.md` → 从 master 创建 `feat/aierp-012a-wecom-readonly-stock`。
- **目标**：用户企微私聊“绑定ERP”获得一次性码，PC 在既有 ERP 登录态完成绑定，然后用真实 AI 查询库存。**先验证可信发送者身份；如拿不到则报告阻断，不能捏造用户身份**。
- **边界**：OpenClaw 不得拥有共享 ERP 管理员 token、shell/SQL/exec、或写单据权限；Java ERP 后端校验用户/租户/仓库；第一阶段只读。
- **验收**：真实企微返回中文物料名称+编码+仓库+单位+ERP 库存；有两个用户/权限隔离证明，缺测试账号要明确标 NOT_VERIFIED；未授权不能查询，未授权写操作不存在。
- **交付**：PR + 只读测试证据 + 脱敏配置变更，`READY_FOR_REVIEW`，Cursor 不合并。
