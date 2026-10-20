# OpenClaw · AI ERP 本地运行与维护规范

> **当前生效路径：Windows native**（优先 **`F:\aierp-openclaw`**；`%LOCALAPPDATA%\aierp-openclaw` 为指向 F: 的 junction）。  
> Docker Compose 仅为镜像可拉取时的**可选备用方案**，本机尚未作为生产路径部署。  
> 官方文档：https://docs.openclaw.ai · https://docs.openclaw.ai/providers/deepseek · https://github.com/WecomTeam/wecom-openclaw-plugin

## 环境勘察结论（本机）

| 项 | 状态 |
|---|---|
| **生效运行时** | **Windows native** OpenClaw 2026.10.x + Node 24.16，**大文件在 `F:\aierp-openclaw`**（可用 `AIERP_OPENCLAW_HOME` 覆盖） |
| Docker Desktop | 可用，但镜像拉取曾阻塞；**当前不要用 Docker 脚本操作已在跑的 native 实例** |
| Ubuntu WSL | 不可用：旧 vhdx 路径缺失；`F:\OpenClaw\` 仅保留历史 WSL/Docker 目录，**不是**本 AIERP 实例 |
| 状态存放 | `F:\aierp-openclaw\state`（`openclaw.json`、plugins、sessions、workspace、`.env`） |
| 私有备份 | `deploy/openclaw/backups\`（D: 盘、已 gitignore；含会话/凭证，**禁止提交 Git**） |
| 网络隔离 | 不加入 ERP Compose 网络；不连 MySQL/Redis |
| Gateway 端口 | **仅** `127.0.0.1:18789`（loopback） |
| 开机自启 | **需用户手动启动**（`.\scripts\start-gateway-native.ps1`）；未安装 Windows 服务常驻 |
| 现有 ERP | `aierp-boot` / `aierp-mysql` / `aierp-redis` 保持不动 |

## 文件分层

| 层级 | 路径 | 说明 |
|---|---|---|
| 仓库模板（可提交） | `deploy/openclaw/openclaw.example.json`、`.env.example`、`workspace/*.md`、`scripts/*.ps1`、`docker-compose.yml` | 脱敏 |
| 本机密钥 | `F:\aierp-openclaw\state\.env`（及仓库旁 `deploy/openclaw/.env`，已 gitignore） | 仅当前用户 ACL |
| **真正生效配置** | `F:\aierp-openclaw\state\openclaw.json` | Cursor 可维护；改前自动备份 |
| **真正生效 MD** | `F:\aierp-openclaw\state\workspace\*.md` | 个性化内容优先，安装脚本不覆盖已有文件 |
| Docker volumes | `aierp_openclaw_state` / `aierp_openclaw_auth` | 仅备用路径；当前未承载生产会话 |

## 一键命令（PowerShell，在 `deploy/openclaw`）

运维脚本默认 **auto-detect**：若存在 native 安装则管理 native，否则才尝试 Docker。

```powershell
cd D:\ERP\ai-erp\deploy\openclaw

# 首次（已完成可跳过）：复制密钥模板
copy .env.example .env
# 编辑 .env：DEEPSEEK_API_KEY / WECOM_BOT_ID / WECOM_BOT_SECRET / OPENCLAW_GATEWAY_TOKEN
# 再安装：
.\scripts\install-windows-native.ps1

# ---- 当前生效：Windows native ----
.\scripts\start-gateway-native.ps1   # 仅停止本项目已归属的 Gateway；Token 不进命令行
.\scripts\health.ps1                 # PID / HTTP / doctor / models / wecom probe（脱敏）
.\scripts\smoke-deepseek.ps1         # 真实模型冒烟
.\scripts\logs.ps1                   # native 日志尾（gateway-run*.log）
.\scripts\restart.ps1                # 安全重启本项目 Gateway + health
.\scripts\backup.ps1                 # → deploy/openclaw/backups\...（默认跳过锁定 sqlite）
.\scripts\backup.ps1 -Consistent     # 短停 Gateway 做完整备份后自动拉起
.\scripts\restore.ps1 -BackupDir .\backups\backup-YYYYMMDDHHMMSS
.\scripts\upgrade.ps1                # 拒绝无版本号升级；需 -NativeVersion 2026.10.5

# ---- 可选：Docker（镜像可拉取且 intentionally 使用时）----
# .\scripts\install.ps1
# .\scripts\health.ps1 -Mode docker
```

管理入口：http://127.0.0.1:18789/  
Gateway Token：从 `F:\aierp-openclaw\state\.env` 的 `OPENCLAW_GATEWAY_TOKEN` 读取（或 `openclaw gateway auth-token --show` 于本机交互终端）。**不要**把 token 写进启动命令行参数。

大体积安装/会话默认落在 **F:**；C: 上保留 junction 兼容旧路径。安装器压缩包等可放 `F:\openclaw-installs\`（与运行时目录分离）。

## 安全约定（Review Fix）

- `start-gateway-native.ps1` **只**结束命令行可证明属于 `%LOCALAPPDATA%\aierp-openclaw` 且含 `openclaw`+`gateway` 的进程；端口被其他程序占用则报错退出，不 `-Force` 误杀 ERP。
- Token 经环境变量 / `openclaw.json` 的 `${OPENCLAW_GATEWAY_TOKEN}` 注入，**不**使用 `--token` 参数。
- 备份目录仅限本机 `backups\`；原始日志与 state **禁止**提交 Git。
- 曾在聊天中暴露过的 Bot Secret / DeepSeek Key：建议用户自行轮换（本仓库不重述）。

## 安装顺序（与 AIERP-011 对齐）

1. 写好受信任 `.env`（勿把密钥发到聊天/PR）。
2. `install-windows-native.ps1`：便携 Node 24.16 + 固定 `openclaw@` 版本 + `tools.profile=messaging` + `deepseek/deepseek-v4-flash`。
3. 插件：`@openclaw/deepseek-provider`、`@wecom/wecom-openclaw-plugin`（Bot + `connectionMode=websocket`）。
4. 单聊 `dmPolicy=pairing`，群聊 `groupPolicy=disabled`；本阶段不启用企微业务工具。
5. `health.ps1` + 企微私聊「你好」/「你可以做什么」。
6. `restart.ps1` 验证持久化与企微重连。

## 正式使用规则

- 改生效 `openclaw.json`：先 `backup.ps1` → 优先 `openclaw config set` → `restart.ps1` → smoke。
- 改行为 MD：优先改 `%LOCALAPPDATA%\...\workspace\`；仓库 `workspace/*.md` 仅作模板同步（安装时不覆盖已有文件）。
- **禁止**：挂 Docker socket、挂宿主根目录、连 ERP MySQL/Redis、公网暴露 18789、宣称已有 ERP 过账能力。

## 验收检查清单

- [ ] `health.ps1` 显示 `runtime=native`，`http_status=200`，`cmdline_token_leak=false`
- [ ] Windows 浏览器打开 `http://127.0.0.1:18789/`
- [ ] DeepSeek 真实回复（`smoke-deepseek.ps1` 或 Control UI）
- [ ] 企微 WS 连接成功；私聊「你好」有模型回复
- [ ] 「你可以做什么」说明仅对话阶段、无 ERP Tool
- [ ] `restart.ps1` 后配置与企微恢复
- [ ] `backup.ps1` / `restore.ps1` 在 native state 上可恢复（私有目录）
- [ ] `doctor` / `channels status --probe` 通过
