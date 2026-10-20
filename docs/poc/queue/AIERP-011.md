# AIERP-011 · OpenClaw + DeepSeek + 企业微信 Bot WebSocket 本机部署

- **状态**：**REVIEW_FIX_PUSHED**（PR #17 Round-1：native 运维脚本安全修复；不重装、不切 Docker）
- **Owner**：Cursor-ERP，分支 `feat/aierp-011-openclaw-local`（从最新 `origin/master` 建）
- **运行时**：因 Ubuntu WSL vhdx 缺失且 Docker 镜像拉取受阻，采用 **Windows 原生隔离安装**（`%LOCALAPPDATA%\aierp-openclaw` + Node 24.16）；仓库仍提供 Docker Compose 模板供镜像可用后切换。
- **已具备资源**：用户已安装 WSL；持有企业微信 API 模式机器人 Bot ID、Secret 和 DeepSeek API Key。**不可要求用户把密钥发聊天或 commit。**
- **目标**：WSL/Docker 中常驻 OpenClaw，连接真实 DeepSeek 模型与企业微信 WS；在企微私聊发“你好”并得到真实模型回复，重启后继续工作。**本任务禁止接入 ERP 写操作**。
- **参考**：`deploy/openclaw/README.md`、`deploy/openclaw/openclaw.example.json`、`deploy/openclaw/workspace/*.md`。

## A. 先勘察，后安装（不影响现有 ERP/HR）

1. WSL 内检查发行版、版本、Docker Engine/Desktop/Compose v2、磁盘剩余与现有容器；核对 `D:\ERP\ai-erp` / WSL 实际路径；若有 OpenClaw 安装或 `~/.openclaw` 状态，先备份并比对，绝不覆盖旧配置。
2. WSL Linux 文件系统内为 OpenClaw 设置**专属状态目录**，例如 `$HOME/.local/share/aierp-openclaw`；不要将长期会话、数据库、密钥放在 `/mnt/d` 或 Git 仓库。Docker 持久化只挂载本实例的 state/workspace，不挂载 Windows 用户目录/其他项目目录、Docker socket 或宿主机根目录。
3. 使用官方 OpenClaw Docker/Compose 安装方案和受信任版本，记录镜像版本/摘要；同一 Gateway 只保留一个运行实例，健康检查 + restart policy。Gateway 端口只发布到 **宿主机 127.0.0.1**；容器内允许 Gateway `lan` 绑定以使本机映射可达，不把 18789 暴露到 0.0.0.0 或公网。
4. 核查是否已有 ai-erp 的 Docker network/容器，以后预留内网接入，但本阶段 OpenClaw **不要连接 MySQL/Redis/jshERP，尤其不得使用 HR 资源**。

## B. 真实模型/插件/Channel

1. 官方 DeepSeek Provider：`openclaw plugins install @openclaw/deepseek-provider`。在实际 OpenClaw 容器/CLI 环境中核对版本和可用模型，**优先 `deepseek/deepseek-v4-flash` 做 POC**，可人工切 `deepseek/deepseek-v4-pro`。不要使用已退役的 `deepseek-chat` 或 `deepseek-reasoner`。
2. 企微官方 Channel：`openclaw plugins install @wecom/wecom-openclaw-plugin` 或官方 `npx -y @wecom/wecom-openclaw-cli install`；只从企业微信官方包安装，先阅读插件来源/权限并核对与当前 OpenClaw 版本兼容。使用 **Bot 模式 + WebSocket**，`channels.wecom.connectionMode=websocket`，不是需要公网 callback 的 Agent 模式。
3. `openclaw.json` 使用 `${WECOM_BOT_ID}` / `${WECOM_BOT_SECRET}`、独立 `DEEPSEEK_API_KEY` 环境变量、`${OPENCLAW_GATEWAY_TOKEN}`；全部真实值存在 WSL 专属 state 下的受信任 `.env`（`chmod 600`）/容器运行环境。***绝对禁止*** Git 提交、echo 回显、截图、日志上传真实 token。
4. 单聊先 `dmPolicy: pairing`（如实际插件版本不支持配对，退到明确的 allowlist），`groupPolicy: disabled`；模型和消息功能用最小 `tools.profile: messaging`，不要打开默认 coding/full 的 exec、shell、browser、web_fetch，也**不要**通过 `tools.alsoAllow=["wecom-openclaw-plugin"]` 无条件启用插件自带的全部企业业务工具。只有明确验证需要时再按最小权限申请。
5. **安装插件后要保证 Docker restart 重启依然生效**：插件存储与 `~/.openclaw/openclaw.json`/workspace 必须处在持久化挂载下。运行 `openclaw doctor`、`openclaw status`、`openclaw models list --provider deepseek`、`openclaw channels status --probe`，版本 CLI 如有差异以真实 `--help` 为准。

## C. Cursor 管理文件的规则（用户特别要求）

- 实际运行的 `openclaw.json` 在 WSL 受控 state 目录，Cursor **允许直接编辑**（先备份、校验、再重启）；Git 中只管理 `deploy/openclaw/openclaw.example.json` 之类**没有实际秘密**的模板。
- Agent workspace 的 `AGENTS.md`、`SOUL.md`、`IDENTITY.md`、`USER.md` 由 Cursor 按 `deploy/openclaw/workspace/` 同步/校对。修改工作区前备份，变更需在仓库 PR 标注差异。所有业务规则和工具限制只能定义行为规范，**真正的权限必须落在服务端 Tool Gateway**。
- 新增/完善 `deploy/openclaw/README.md`、脚本 `install` / `health` / `backup` / `restore` / `logs` / `restart` / `upgrade`（可以 PowerShell 调 WSL shell，也可仅提供 Linux shell），优先做最少但可复现的一键操作；运行后输出脱敏报告与下一步指令。
- 升级需要保留版本、备份后执行、健康检查失败可回滚。不自动覆盖用户已有全局 OpenClaw 安装/任何非本项目机器人。

## D. 测试与交付（必须区分本地检查与真实企微）

1. `docker compose ps` 显示 Gateway 正常且重启可恢复；Windows 浏览器通过 `http://127.0.0.1:18789` 本机访问（如端口冲突选择新本机端口）。
2. DeepSeek 模型一条真实 API 回复成功，记录模型 ID/响应耗时，不记录请求密钥。
3. 企微机器人一对一：发送“你好”→ 得到**真实 DeepSeek 回复**；发送“你可以做什么”→ 回复 AIERP 当前仅对话准备阶段，不能声称已能提交 ERP 采购单。验证断线自动重连。
4. 无模型 Key、错误企微 Secret、断网/模型超时的情况下给出诊断，不重复拉起无限 Gateway。验证日志不包含 Secret、Key、完整隐私对话。
5. Docker 状态卷备份/恢复步骤有效；WECOM/DeepSeek 密钥所在文件权限受限。
6. README 精确记录当前 WSL Linux 路径、Compose/镜像版本、网络名、Web UI 地址、实际模型、插件 ID、命令与证据截图；请在任务文档写 `READY_FOR_REVIEW` 并反馈分支 SHA 和最小验收结果（不要包含真实密钥）。

## 禁止范围

- **本阶段不修改 ERP Java 网关/数据库/采购审核，不创建真实 ERP 单据，不开群聊写操作。**
- 不要求公网服务器、不开放 Gateway 公网控制口，不跨项目复用 HR Docker。
- 不让模型执行 arbitrary shell、docker、SQL，也不认为 `AGENTS.md` 中一条文字就能实现数据权限。
- 如需用户手工确认 Bot ID/Secret 的读取位置，列出 WSL 本地路径供用户填写后继续，**不要停下来等待用户把密钥发给 ChatGPT**。
- Cursor 不自行 merge；提交 PR 或 push 并反馈 `READY_FOR_REVIEW`，由 ChatGPT Review。

## READY_FOR_REVIEW · 本机结果（脱敏）

- **HEAD**：见 push 后 SHA；分支 `feat/aierp-011-openclaw-local`
- **管理入口**：http://127.0.0.1:18789/ （token 在本机 `deploy/openclaw/.env` 的 `OPENCLAW_GATEWAY_TOKEN`，勿提交）
- **模型**：`deepseek/deepseek-v4-flash`（agent smoke 返回 `AIERP-011-OK`）
- **企微**：`channels status --probe` → `enabled, configured, running, works`
- **密钥路径**：`D:\ERP\ai-erp\deploy\openclaw\.env` 与 `%LOCALAPPDATA%\aierp-openclaw\state\.env`（ACL 限当前用户）
- **证据**：`deploy/openclaw/logs/evidence-aierp-011.md`、`deepseek-smoke.txt`
- **待用户**：企微私聊「你好」「你可以做什么」；若 pairing，在 Control UI 批准；建议事后轮换已在聊天中暴露过的密钥
- **AIERP-012**：未执行

## REVIEW_FIX（PR #17 Round-1）

- `start-gateway-native.ps1`：只停止归属本项目的 `node … gateway run`；拒绝误杀；**不再**传 `--token` / `--force`
- `health/backup/restore/restart/logs/upgrade/smoke`：默认 auto-detect → **native**（`%LOCALAPPDATA%\aierp-openclaw`）；Docker 需显式 `-Mode docker`
- 备份目录：`deploy/openclaw/backups\`（gitignore；C: 盘空间紧张时避免写 LOCALAPPDATA）
- README：Windows native 为当前生效路径；开机需手动 `start-gateway-native.ps1`
- 本机复验：`cmdline_token_leak=false`、HTTP 200、DeepSeek `AIERP-011-OK`、企微 probe `works`、restore 清除 workspace 多余文件
