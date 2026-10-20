# OpenClaw · AI ERP 本地运行与维护规范

> Repo 模板 + 本机 Docker Desktop 部署说明。官方文档：
> https://docs.openclaw.ai/install/docker · https://docs.openclaw.ai/providers/deepseek · https://github.com/WecomTeam/wecom-openclaw-plugin

## 环境勘察结论（本机）

| 项 | 状态 |
|---|---|
| Docker Desktop | 可用（Engine 28.x / Compose v2） |
| Ubuntu WSL | **不可用**：`D:\OpenClaw\Ubuntu\ext4.vhdx` 缺失（`ERROR_PATH_NOT_FOUND`） |
| 状态存放 | 使用 Docker named volumes `aierp_openclaw_state` / `aierp_openclaw_auth`（落在 Docker Desktop Linux VM，非 `/mnt/d`、非 Git 仓库） |
| 网络隔离 | Compose project `aierp-openclaw`，网络 `aierp_openclaw_net`，**不**加入 `deploy_default` / MySQL / Redis |
| Gateway 端口 | **仅** `127.0.0.1:18789` → 容器 `18789` |
| 现有 ERP | `aierp-boot` / `aierp-mysql` / `aierp-redis` 保持不动 |

若日后修复 Ubuntu WSL，可将 volume 导出到 `$HOME/.local/share/aierp-openclaw` 再 bind-mount；当前以 Docker volume 为准。

## 文件分层

- **仓库模板（可提交）**：`openclaw.example.json`、`.env.example`、`docker-compose.yml`、`workspace/*.md`、`scripts/*.ps1`
- **本机密钥（禁止提交）**：`deploy/openclaw/.env`（已 gitignore；Windows ACL 限制为当前用户）
- **运行时状态**：Docker volume `aierp_openclaw_state` → 容器 `/home/node/.openclaw`（含 `openclaw.json`、plugins、sessions、workspace）

## 一键命令（PowerShell，在 `deploy/openclaw`）

```powershell
cd D:\ERP\ai-erp\deploy\openclaw
# 1) 复制并填写密钥（若尚无 .env）
copy .env.example .env
# 编辑 .env：DEEPSEEK_API_KEY / WECOM_BOT_ID / WECOM_BOT_SECRET / OPENCLAW_GATEWAY_TOKEN

# 路径 A（首选）：Docker 镜像可拉取时
.\scripts\install.ps1          # 拉镜像、灌 workspace、启动、装插件

# 路径 B（本机已验证需求）：Docker Hub/GHCR 拉不动时
# OpenClaw 2026.10+ 需要 Node >=24.16；脚本会下载便携 Node 到 %LOCALAPPDATA%\aierp-openclaw
.\scripts\install-windows-native.ps1

.\scripts\health.ps1           # doctor / models / channels probe（Docker 路径）
.\scripts\smoke-deepseek.ps1   # 真实模型冒烟
.\scripts\logs.ps1             # 脱敏日志尾
.\scripts\restart.ps1          # 重建容器（使 .env 生效）
.\scripts\backup.ps1           # 备份 volume → state/backup-*
.\scripts\restore.ps1 -BackupDir .\state\backup-YYYYMMDDHHMMSS
.\scripts\upgrade.ps1          # 备份后拉新镜像并重建
```

管理入口：http://127.0.0.1:18789/ （Settings 粘贴 `OPENCLAW_GATEWAY_TOKEN`）

## 安装顺序（与 AIERP-011 对齐）

1. 写好受信任 `.env`（勿把密钥发到聊天/PR）。
2. `install.ps1`：官方镜像 + 隔离 Compose + `tools.profile=messaging` + 模型 `deepseek/deepseek-v4-flash`。
3. 插件：`@openclaw/deepseek-provider`、`@wecom/wecom-openclaw-plugin`（Bot + `connectionMode=websocket`）。
4. 单聊 `dmPolicy=pairing`，群聊 `groupPolicy=disabled`；**不要** `tools.alsoAllow=["wecom-openclaw-plugin"]`（本阶段不启用企微业务工具）。
5. `health.ps1` + 企微私聊「你好」/「你可以做什么」。
6. `restart.ps1` 验证持久化。

## 正式使用规则

- 改 `openclaw.json`：先 `backup.ps1` → 容器内/CLI `config set` 优先 → `restart.ps1` → smoke。
- 改 `workspace/*.md`：先改仓库模板，再同步进 volume（`install.ps1` 会 `cp` workspace；已有个性化内容会覆盖前请自行备份）。
- Cursor 允许维护本机 volume 内配置；Git 只收脱敏模板。
- **禁止**：挂 Docker socket、挂宿主根目录、连 ERP MySQL/Redis、公网暴露 18789、宣称已有 ERP 过账能力。

## 验收检查清单

- [ ] `docker compose -f deploy/openclaw/docker-compose.yml ps` Gateway healthy
- [ ] Windows 浏览器打开 `http://127.0.0.1:18789/`
- [ ] DeepSeek 真实回复（`smoke-deepseek.ps1` 或 Control UI）
- [ ] 企微 WS 连接成功；私聊「你好」有模型回复
- [ ] 「你可以做什么」说明仅对话阶段、无 ERP Tool
- [ ] `restart.ps1` 后配置与企微恢复
- [ ] `doctor` / `channels status --probe` 通过（命令以容器内 `--help` 为准）
