# AI-ERP Cursor Agent · 当前任务：AIERP-011

用户已具备 WSL、企业微信 Bot ID+Secret、DeepSeek API Key。**立即开始本地 OpenClaw 安装和配置**，只操作 `youxihe/ai-erp`。

阅读 `docs/poc/queue/AIERP-011.md`、`deploy/openclaw/README.md` 和模板 `deploy/openclaw/openclaw.example.json`、`deploy/openclaw/workspace/*.md`，从最新 master 新建 `feat/aierp-011-openclaw-local`。Cursor 负责 WSL/Docker 安装、实际 `openclaw.json`、workspace MD 文件、密钥从 WSL 本地 env 读取、企微 Channel、DeepSeek 插件、诊断和一键管理脚本。

**第一期验收**：企业微信 WebSocket 私聊真实 DeepSeek 回复、重启仍正常、密钥绝不进 Git、工具仅限聊天；禁止现在修改 ERP 过账接口或用共享 ERP 管理员账户。完成 push READY_FOR_REVIEW，不能自行 merge。下一棒 `AIERP-012` 暂未 RELEASED，ChatGPT Review 后再开放。
