# OpenClaw · AI ERP 本地运行与维护规范

> Repo-only 模板与规范，**不是已部署证明**。Cursor 应先确认 WSL / Docker 实际状态再执行。官方文档：
> https://docs.openclaw.ai/install/docker
> https://docs.openclaw.ai/providers/deepseek
> https://github.com/WecomTeam/wecom-openclaw-plugin

## 文件分层

- 仓库版本化模板：`deploy/openclaw/openclaw.example.json`、`.env.example`、`workspace/AGENTS.md`、`workspace/SOUL.md`、`workspace/IDENTITY.md`、`workspace/USER.md`；随后增加 Cursor 使用的 Compose/脚本。
- **实际运行配置**：WSL 专属 `$HOME/.local/share/aierp-openclaw` 下、持久化映射至容器的 `/home/node/.openclaw`；该目录可以按机器状况调整，但需在文档记录。配置实际文件为 state 中的 `openclaw.json`，用户明确允许 Cursor 维护此文件。
- 实际密钥：WSL 专属 state 的受信任 `.env`、`chmod 600`，容器要可见。不要将真实 `.env` 放到 `workspace` 或 Git 项目。
- 同步工作区时不要覆盖 Cursor 用户之前写的内容；原文件按时间戳备份，Git 模板仅作为业务基线。

## 安装顺序（先官方 Docker，禁止重写未核实的 CLI 选项）

1. WSL 下 `docker info`、`docker compose version`、`ls -la ~/.openclaw` 与本机 AIERP Compose 检查；如已有全局 OpenClaw，避免共享目录。
2. 使用官方 Docker 镜像/Compose 推荐方案启动 isolated gateway，绑定宿主 `127.0.0.1:18789:18789`，Docker 容器内 `gateway.bind: "lan"`；端口冲突先询问/改另一 loopback 端口。禁止 Docker socket/host root mounts。
3. DeepSeek 官方 Provider 插件 `@openclaw/deepseek-provider`；`DEEPSEEK_API_KEY` 通过受信任 env 提供；初期模型建议 `deepseek/deepseek-v4-flash`（可切 pro）。`deepseek-chat` / `deepseek-reasoner` 已退役，不得复用旧 model ID。
4. 企业微信官方 `@wecom/wecom-openclaw-plugin`，`botId`、`secret` 用环境变量引用；`connectionMode: "websocket"`；单聊 pairing/allowlist、群聊 disabled；不启用所有 wecom-cli 企业业务工具。
5. 按实际安装版本验证 `openclaw config`、`openclaw doctor`、`openclaw status`、`openclaw channels status --probe`、`openclaw models list --provider deepseek`。CLI 功能变化以运行中 `--help` 和官方最新文档为准。
6. 企微私聊发送“你好”验证模型真实回复；再次 `docker compose restart` 验证持久性。下一任务接 ERP 前不得宣称有业务工具。

## 正式使用规则

- 更新 `openclaw.json`：**备份 → 改本机实际文件 → 运行配置校验 → 重启/热更新 → smoke → 记录脱敏差异**。
- 更新 `workspace/*.md`：写入仓库模板，备份 state workspace 同名文件，同步；真实个人资料/聊天记录不可提交。
- 管理命令：`ps` / `logs` / `restart` / `backup` / `restore` / `upgrade` 均按最终 Compose 文件实施并记录；尽量做 repo 一键脚本但不需要新装一套 DevOps 系统。
- 仅 Gateway/官方 Channel 可以连外部服务；MySQL/Redis 不暴露 Agent，也不应挂载 HR 或 Windows 用户整个磁盘到容器。
- 升级先记录版本和 SHA，备份所有状态/配置，更新后跑 `doctor`、企微对话探针；失败可恢复到旧镜像和状态快照。
