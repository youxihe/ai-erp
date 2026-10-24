# AI-ERP → Workbuddy 正式技术交接

**交接日期**：2026-10-24  
**仓库**：`youxihe/ai-erp`  
**交接时 GitHub `origin/master`**：`0614a394`（含已合并的 AIERP-020C）  
**交接性质**：停止 Cursor 多任务并行开发；由 Workbuddy **单任务串行**接手部署与后续功能。  
**禁止**：把「GitHub 已合并」写成「本机已部署」；勿把密钥/Token 写入本文或提交到 Git。

---

## 1. 项目现状

### 1.1 目标与 Demo 阶段

本地 Windows POC：通过 **企业微信 Bot（OpenClaw）** 操作真实 **jshERP**（采购入库、配制 MIX、服务耗料 SERVICE、只读查询），做到：

- 企微用户 **绑定 ERP 身份** 后才能查/写；
- 写操作必须 **本人原始确认**（非模型自报、非群聊代确认）；
- 过账走 **原生 ERP 审核**，带 **幂等**；
- 采购等业务尽量有 **PDF 回执**；后续要有通用图表与经营总览（无新 H5）。

当前阶段：**可演示、可本地 UAT**，不是生产多租户 SaaS。唯一业务域：`youxihe/ai-erp`（与 HR/HCM 等项目隔离）。

### 1.2 三态约定（必须分清）

| 状态 | 含义 |
|---|---|
| **MERGED** | 已在 GitHub `master` |
| **LOCAL_DEPLOYED** | 本机 Docker JAR + `F:\aierp-openclaw` 插件已同步且健康检查通过 |
| **LIVE_UAT** | 真人企微客户端已验证（文本/文件/图片/卡片） |

三者独立。下文「可用」默认指业务逻辑在 master 或本机某一版可跑；**不等于**最新 master 已上线。

### 1.3 已实现且业务上可用（以本机曾验收 / 合并代码为准）

| 能力 | 说明 | 备注 |
|---|---|---|
| 企微 ↔ ERP 绑定 | HMAC 适配器签名 + 绑定码 claim | 未绑定不可查库存 |
| 库存 / 物料 / 伙伴 / 单据查询 | WeCom 路由只读 | 仓库权限过滤 |
| 采购 Excel → 预览 → 草稿 → 本人确认 → 原生入库 | 015B / 017B1 等已真人走过 | 例：GW-PURCHASE-119 |
| 多张采购 Excel 草稿（017B2） | 已入 master | 真人多单 UAT 未完全收口 |
| 配制 MIX 草稿/确认链路（016M） | 已入 master | 真人 MIX UAT 待补 |
| 服务耗料 SERVICE（016S） | 已入 master | 真人 SERVICE UAT 待补 |
| 采购 PDF 回执生成 | 后端可生成；015C 曾送达企微 PDF | 自动送达稳定性仍依赖通道 |
| PC Demo 工作台 | Vue 前端，可选 | H5 未作为主路径 |

### 1.4 代码已在 master / 分支，但尚未完成本机部署或企微验收

| 项 | Git | 运行态（2026-10-24 实测） |
|---|---|---|
| **020C 图表库** | **已 MERGED** `0614a394` | **未 LOCAL_DEPLOYED**：F: 插件无 `render-lib`；未接企微图片发送 |
| **020B 原生卡片** | 仅分支 `feat/aierp-020b-wecom-native-card-renderer` | 未合并、未部署 |
| **020D 经营总览** | 仅任务卡 `docs/poc/queue/AIERP-020D.md` | 未开发 |
| **022A 统一审计 + MIX/SERVICE PDF** | 分支 `feat/aierp-022a-unified-mutation-audit-pdf` | 未合并；采购 PDF ≠ MIX/SERVICE PDF |
| **022B PDF 自动送达加固** | 分支 `feat/aierp-022b-receipt-auto-delivery` | 未合并 |
| **021A 供应商/客户主数据写** | 分支 `feat/aierp-021a-partner-masterdata-sop` | 未合并；可先只读/预览，写入需安全闸门 |
| **021B 物料主数据写** | 分支 `feat/aierp-021b-material-masterdata-sop` | 未合并 |
| **017C1 批次一次确认** | 规划/分支 WIP | 未作为默认开放确认入口 |

### 1.5 各主线真实状态（重点）

| 主线 | 状态 |
|---|---|
| **采购** | 主路径最成熟：Excel → 草稿 →「确认采购…」→ 原生已审核 + 采购 PDF。多单/批次体验未完全收口。 |
| **配制生产 MIX** | 代码在 master；配方预览/确认短语隔离已做自动化。真人端到端与专用 PDF 仍弱。 |
| **服务耗料 SERVICE** | 代码在 master；确认前库存不变、跨类型确认拒绝有测试。真人 UAT 与专用 PDF 仍弱。 |
| **PDF 回执** | **采购**可生成且历史上发过企微文件；**MIX/SERVICE** 常仍是文本或未版本化专用版式；「生成成功 ≠ 客户端已打开」。 |
| **主数据管理** | 查询可用；**建档/改档**在独立分支，未进 master 默认运行态。 |
| **020C 图表库** | master 有完整 `deploy/openclaw/sop/render-lib`（密封 `datasetRef`、table/bar/line/pie/delta/kpi）。自动化 smoke 曾对真实 ERP 库存表 + 采购汇总柱图出 PNG。**未同步 F:，企微看不到图。** |

### 1.6 已知缺陷 / 风险

1. **发布滞后**：本机 JAR/插件 ≠ `0614a394`（见 §3.5）。  
2. **020C 未接线**：无 SOP/tool 在查询后 `sealAndRender` 并经 Bot WS 发 image。  
3. **富消息**：`wecom-business` 等仍偏纯文本 / first-line；原生 template card 未验收。  
4. **PDF**：MIX/SERVICE 与采购版式混用风险；旧 layout 覆写问题在 022A 任务中。  
5. **并行 worktree 残留**：`D:\ERP\ai-erp-*` 多目录是历史并行开发痕迹，**不要再用它们覆盖 F:**。  
6. **双用户/跨仓 UAT**、销售口径接入仍不完整。  
7. `verify-demo-release.ps1` 的 `doc.html` 探针偶发 404；更稳的探针可用 `user/login` 或实测 200 的 doc 路径。

### 1.7 下一步优先（给 Workbuddy）

1. **立刻**：把 master `0614a394`（至少 OpenClaw 插件 + `sop/render-lib`）同步到 F:，健康检查通过。  
2. **第一开发任务**：020C → 企微 **真实图片**：授权库存 table PNG + 采购统计 bar PNG。  
3. **然后**：020B 原生卡片（多行明细）。  
4. **再**：020D 经营总览（无 H5）。  
5. 再往后：022A → 022B → 021A/021B → 017C1（单任务推进）。

---

## 2. 源码与环境

### 2.1 Git

| 项 | 值 |
|---|---|
| GitHub | https://github.com/youxihe/ai-erp |
| SSH remote | `git@github.com:youxihe/ai-erp.git` |
| 交接时 master | `0614a394` |
| 操作方式 | **仅 SSH** `git fetch/pull/push`；**不要**用 `gh` / 浏览器 GitHub OAuth（易弹登录框） |

```powershell
git remote -v   # 应为 git@github.com:youxihe/ai-erp.git
git fetch origin master
git checkout master
git pull origin master
git rev-parse HEAD   # 应对齐 origin/master
```

### 2.2 本机目录

| 路径 | 用途 |
|---|---|
| `D:\ERP\ai-erp-handoff` 或干净 `master` 检出 | **推荐**日常开发根目录（从最新 master 拉出） |
| `D:\ERP\ai-erp-master` | 历史部署用 worktree，交接时停在旧 commit + 本地脏文件，**勿盲目覆盖 F:** |
| `D:\ERP\ai-erp-020c` 等 | 旧功能分支 worktree；归档，不再并行开发 |
| `F:\aierp-openclaw` | **生效** OpenClaw 运行时（Node + state） |
| `%LOCALAPPDATA%\aierp-openclaw` | 常为指向 F: 的 junction |

重要模块：

```text
jshERP-boot/          Java 后端（Spring Boot + 网关 com.jsh.erp.gateway）
jshERP-web/           Vue 演示前端（可选 :3000/:3001）
deploy/docker-compose.yml
deploy/docker-compose.boot-hot.yml
deploy/runtime/app.jar          # 热更新产物（gitignore 常见）
deploy/sql/                     # 库迁移脚本
deploy/openclaw/sop/            # SOP 脚本（含 render-lib）
deploy/openclaw/plugins/aierp-erp-tools/   # 插件源（同步到 F:）
deploy/openclaw/workspace/      # AGENTS.md / skills 模板
deploy/scripts/                 # 自动化与发布脚本
docs/poc/                       # 任务卡、ADR、证据、本交接文
```

### 2.3 技术架构（简图）

```text
企微客户端
    │  Bot WS
    ▼
OpenClaw Gateway (:18789 loopback)
    │  plugin aierp-erp-tools + SOP
    │  HMAC 签名 HTTP
    ▼
aierp-boot JAR (:9999)  ──►  aierp-mysql (:13306) / aierp-redis (:16379)
```

| 组件 | 实测 |
|---|---|
| Java | OpenJDK 8（容器内 `1.8.0_504` Temurin） |
| MySQL | 8.0.36（容器 `aierp-mysql`） |
| Redis | 容器 `aierp-redis` |
| OpenClaw | npm `openclaw` ^2026.10.5；本机 Node **24.16**（F:\ 自带） |
| 宿主 Node（脚本） | 本机另有 v22.x 亦可跑 smoke |

### 2.4 F:\aierp-openclaw 布局

```text
F:\aierp-openclaw\
  bin\  node\  node_modules\  package.json
  state\
    openclaw.json          # 生效配置（含插件、通道；含密钥，勿提交）
    .env                   # 密钥（勿提交、勿写入本文）
    extensions\aierp-erp-tools\   # ★ 真正加载的插件
      index.js
      openclaw.plugin.json
      sop\...
    workspace\             # 生效 AGENTS.md / skills
    media\                 # 附件/渲染缓存
```

Gateway 进程示例（交接时存活）：

`node ...\openclaw\openclaw.mjs gateway run --bind loopback --port 18789 ...`

### 2.5 核心 SOP / 配置 / SQL（路径）

| 类型 | 路径 |
|---|---|
| SOP 注册 | `deploy/openclaw/sop/registry.mjs`（插件侧镜像 `plugins/.../sop/registry.mjs`） |
| 采购批次准备 | `sop/purchase-batch-prepare.mjs` |
| MIX | `sop/mix-prepare.mjs`, `register-mix-confirm.mjs` |
| SERVICE | `sop/service-consume.mjs` |
| PDF 发送 | `sop/receipt-send.mjs`, `wecom-outbound.mjs` |
| 企微文案渲染 | `sop/renderers/wecom-business.mjs` |
| **020C 图表** | `deploy/openclaw/sop/render-lib/**` |
| 能力目录 | `deploy/openclaw/catalog/erp-capabilities.yaml` |
| 配置模板 | `deploy/openclaw/openclaw.example.json`, `.env.example` |
| SQL | `deploy/sql/02-*.sql` … `07-aierp-015b-confirm-receipt.sql`（022A 审计表若在分支，合并前勿假设已建） |

密钥位置（**只读本机文件，勿提交**）：

- `deploy/.env`（Docker / 适配器密钥）  
- `F:\aierp-openclaw\state\.env`、`openclaw.json`

### 2.6 JAR 与插件发布关系

| 产物 | 来源 | 生效位置 |
|---|---|---|
| Boot JAR | `jshERP-boot` Maven 打包 | `deploy/runtime/app.jar` bind-mount → 容器 `/app/app.jar` |
| OpenClaw 插件 | `deploy/openclaw/plugins/aierp-erp-tools` + 共享 `deploy/openclaw/sop` | 复制到 `F:\aierp-openclaw\state\extensions\aierp-erp-tools`（及 SOP 相对引用所需的 `sop/render-lib`） |

- **改 Java** → `hot-reload-boot.ps1` → 必须核对宿主/容器 JAR SHA 一致。  
- **改 SOP/插件/render-lib** → 同步 F: → **重启 Gateway**（只重启 OpenClaw，不必重编 JAR）。  
- 二者独立；只合 master 不会自动更新任一侧。

---

## 3. 如何运行和发布

### 3.1 日常开发（单任务）

```powershell
cd <干净 master 检出>
git fetch origin master
git checkout master
git pull origin master
git checkout -b feat/<ticket>-short-name

# Java（在 Docker 网络可达时）
powershell -File deploy/scripts/hot-reload-boot.ps1

# 或仅测前端
# cd jshERP-web; npm start   # 注意端口占用
```

### 3.2 自动化测试（无过账优先）

在仓库根目录，需本机 Boot + 适配器密钥已配置（从本机 `.env` 读取，不要写进文档）：

```powershell
node deploy/scripts/aierp-013-query-flow.mjs          # 只读查询 / 仓权限
node deploy/scripts/aierp-015b-confirm-flow.mjs       # 确认链路（注意是否真过账开关）
node deploy/scripts/aierp-016m-mix-prepare.mjs        # MIX 非过账
node deploy/scripts/aierp-016s-service-consume.mjs    # SERVICE 非过账
node deploy/scripts/aierp-017b2-multi-purchase.mjs    # 多采购草稿
node deploy/scripts/aierp-020c-render-smoke.mjs       # 图表库 + 真实 ERP seal（需密钥）
powershell -File deploy/scripts/verify-demo-release.ps1
```

证据落在 `docs/poc/evidence/`。跑写库测试前确认脚本的 confirm 开关为关，除非用户明确要求真人过账。

### 3.3 Docker / JAR 热更新

```powershell
# 编译 + 替换 app.jar + force-recreate aierp-boot
powershell -File deploy/scripts/hot-reload-boot.ps1

# 仅重启已有 jar
powershell -File deploy/scripts/hot-reload-boot.ps1 -SkipCompile
```

Compose 目录：`deploy/`，使用 `docker-compose.yml` + `docker-compose.boot-hot.yml` + `--env-file deploy/.env`。

### 3.4 OpenClaw 插件同步与 Gateway 重启

```powershell
$src = "D:\ERP\<repo>\deploy\openclaw\plugins\aierp-erp-tools"
$dst = "F:\aierp-openclaw\state\extensions\aierp-erp-tools"
# 先备份
Copy-Item $dst "$dst.bak-$(Get-Date -Format yyyyMMddHHmmss)" -Recurse -Force
# 同步插件（含 sop）
robocopy $src $dst /MIR /NFL /NDL /NJH /NJS

# 020C：确保 render-lib 可被插件 re-export 解析到
# 插件内为: export from ../../../../sop/render-lib
# 因此仓库侧 deploy/openclaw/sop/render-lib 也必须出现在 F: 对应相对路径，
# 或改为把 render-lib 一并拷进 extensions 包内并改 import（推荐部署时保持与仓库相同相对布局）。
$sopSrc = "D:\ERP\<repo>\deploy\openclaw\sop"
$sopDst = "F:\aierp-openclaw\state\extensions\sop"   # 若采用与仓库平行的布局需与 import 一致
# 实际以插件 index 的相对路径为准：当前源码期望
#   extensions/aierp-erp-tools/sop/render-lib -> ../../../../sop/render-lib
#   即 F:\aierp-openclaw\state\sop\render-lib 或按仓库 deploy/openclaw 整树同步。
# 稳妥做法：同步整个 deploy/openclaw/{plugins,sop,workspace} 到 state 下约定位置后重启。

cd D:\ERP\<repo>\deploy\openclaw
.\scripts\restart.ps1
.\scripts\health.ps1
```

Gateway：`http://127.0.0.1:18789/` · 健康：`GET /health` → `{"ok":true,"status":"live"}`。

### 3.5 交接时真实运行版本（2026-10-24 实测）

| 项 | 值 | 结论 |
|---|---|---|
| GitHub `origin/master` | `0614a394` | MERGED 含 020C |
| 部署用检出 `D:\ERP\ai-erp-master` HEAD | `cf96c8dd`（另有本地未提交改动） | **落后 master** |
| Host JAR SHA256 | `5995bcb51b97c00ee654e0e5c443d360b80909bd367c960fcf984fec61364800` | 与容器一致 |
| Container JAR SHA256 | 同上 | host=container **PASS** |
| JAR 时间 | 2026-10-24 10:20:48 | 早于/不等于 020C merge 部署 |
| JAR.bak 前缀 | `29dc3442c658db05…` | 可回滚 |
| F: `index.js` SHA256 | `74fa915f9e7eff67…` | |
| master 同文件 SHA256 | `c460fb100df18304…` | **不一致** → 插件未对齐 master |
| F: `render-lib` | **不存在** | 020C **未部署** |
| Boot `user/login` | HTTP 200 | PASS |
| Boot `doc.html` | 本次 200（verify 脚本曾报 404） | 不稳定探针 |
| Gateway `/health` | 200 `live` | PASS |
| 容器 | `aierp-boot` / `aierp-mysql` healthy / `aierp-redis` healthy | 运行中 |

**结论：当前运行态不是 GitHub 最新 master；020C 未 LOCAL_DEPLOYED；未宣称 LIVE_UAT 图片消息。**

F: 插件关键文件指纹（交接快照）：

| 文件 | SHA256 |
|---|---|
| `index.js` | `74fa915f9e7eff67c125b65ea771bb242ecbfeb37578df2a33cfd38b6de92674` |
| `sop/registry.mjs` | `ca3be1887b99cd557fcaf4f5153297d9e4692517041d953405d882679e91266e` |
| `sop/receipt-send.mjs` | `5377e16a26524960237706dfaa6a945090da808f34de00576f7983d9c4b1bb78` |
| `sop/mix-prepare.mjs` | `202ecc601eb7e81f5324b090c65f8c3d74ae350c55e2a09562c1aa533bebbde4` |
| `sop/service-consume.mjs` | `58b2234ac33a109d2984b46b18de1faf31e381dc85556aa91ef503eb715ce123` |
| `sop/wecom-outbound.mjs` | `cf0f3d7b95a342604ab7e1ddf1cec04a3e2c7121e6bd936acec94805ba3c6c34` |
| `sop/renderers/wecom-business.mjs` | `4b9efd8de3e66de431eef07a47b4b491a3836eda34e7bf1946be9271d2b3a0f5` |

### 3.6 发布失败回滚

```powershell
# JAR
Copy-Item deploy\runtime\app.jar.bak deploy\runtime\app.jar -Force
docker compose --env-file deploy/.env -f deploy/docker-compose.yml -f deploy/docker-compose.boot-hot.yml up -d --force-recreate --no-deps aierp-boot

# 插件
# 恢复同步前的 $dst.bak-时间戳 目录
.\scripts\restart.ps1
```

OpenClaw 完整备份/恢复：`deploy/openclaw/scripts/backup.ps1` / `restore.ps1`。

### 3.7 版本与健康检查清单

```powershell
git fetch origin master
git rev-parse HEAD
git rev-parse origin/master
Get-FileHash deploy\runtime\app.jar -Algorithm SHA256
docker exec aierp-boot sha256sum /app/app.jar
Get-FileHash F:\aierp-openclaw\state\extensions\aierp-erp-tools\index.js -Algorithm SHA256
Invoke-WebRequest http://127.0.0.1:18789/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:9999/jshERP-boot/doc.html -UseBasicParsing
powershell -File deploy/scripts/verify-demo-release.ps1
```

仅当：**HEAD==origin/master**、**host JAR==container JAR**、**F: 插件 hash==检出**、健康 200，才可标记 `LOCAL_DEPLOYED`。

---

## 4. 业务流程与关键安全设计

### 4.1 Excel → 草稿 → 确认 → 过账

1. 用户要模板 / 上传 XLSX（企微文件）。  
2. 后端解析预览（Redis 暂存），**禁止模型猜数建草稿**。  
3. 创建 **未审核草稿**（库存不变）。  
4. 用户发送**原始确认短语**（如「确认采购{id}」「确认配制…」「确认耗料…」），SOP 校验类型隔离。  
5. 网关以绑定 ERP 用户身份调用原生审核；**幂等键**防重复入账。  
6. 成功后查原生单号；采购侧生成 PDF；发送依赖 receipt-send / outbound。

### 4.2 权限 / 绑定 / 幂等

- 适配器请求：HMAC（timestamp/nonce/signature），拒绝伪造 `erpUserId`/`tenantId`。  
- 企微用户必须 ACTIVE 绑定；禁用用户/停用或过期租户拒绝查询。  
- 仓库权限：无仓权不可见跨仓混合单据敏感字段。  
- 写操作：绑定代际（binding version）、本人确认、业务幂等；模型工具不应直接暴露万能 confirm。

### 4.3 PDF

- 采购回执：已有生成路径；文件应视为凭证（022A 要求不可变版本/sha）。  
- 发送：`receipt-send` + `wecom-outbound`；媒体路径白名单；失败可重发 PDF，**不得重过账**。  
- 验收标准：客户端打开 PDF ≠ 文本里出现 `MEDIA: F:\...`。

### 4.4 SOP 与 OpenClaw 职责

| 层 | 职责 |
|---|---|
| OpenClaw / 模型 | 理解意图、选 tool/SOP、选 **renderId**；不编造金额/库存 |
| SOP 脚本 | 确定性流程、确认短语、调用 signedPost、组装回执 |
| Java Gateway | 鉴权、绑定、业务、PDF、审计 |
| Channel adapter | 发 text/file/image/card；剥离本地路径 |

### 4.5 020C 图表与授权 datasetRef

**错误（已禁止）**：模型传 `authorized:true` / `nature:"REAL_ERP"` / 内联假数据。

**正确**：

```js
import { sealAndRender, sealDataset, renderDataset } from ".../render-lib/index.mjs";

// 1) 适配器先完成真实授权 ERP 查询
// 2) 用当前 authCtx 密封
const out = await sealAndRender(authCtx, {
  renderId: "table.basic", // 或 bar.compare / line.trend / pie.share / delta.before_after / kpi.tiles
  sourceKind: "ERP_QUERY",
  sourcePath: "/aierp/v1/wecom/stock/query",
  depotScope: ["原料仓"],
  dataset: { /* 仅来自查询结果的 canonical 结构 */ },
}, { writeFiles: true });

// 模型侧只允许：
// renderDataset({ renderId, datasetRef: { id: "ds_<32hex>" } }, { authCtx })
```

`authCtx` 必含：`tenantId`, `actorUserId`, `wecomUserId`, `botId`, `bindingVersion`。  
媒体写入：`state/media/aierp-render/{tenant}/{actor}/` 随机文件名。  
长表可附 XLSX；单元格防公式注入。

Smoke 证据：`docs/poc/evidence/aierp-020c-render-smoke.json`、`AIERP-020C-REVIEW_FIX_PUSHED.md`。

---

## 5. Workbuddy 如何继续开发

### 5.1 工作方式（生效）

- **一次只做一个开发任务**；做完构建 → 部署 → 企微验证 → 再开下一个。  
- **始终从最新 `origin/master` 开分支**。  
- 开发完成即本机部署验证；需要时由 **ChatGPT Review** 修问题。  
- **禁止**再开多个并行 Agent / 多个共享运行态互盖 F:。  
- Git：**SSH only**；不建多余 PR 流程依赖 `gh`；本交接文档已约定直接提交 master 的文档例外仅此一次。

### 5.2 建议第一项任务（020C 企微可见）

目标：用户在企微看到 **真实库存表格 PNG** 与 **采购统计柱状图 PNG**。

建议步骤：

1. `git pull` 到 `0614a394`+（含本交接文后的新 HEAD）。  
2. 同步 `plugins/aierp-erp-tools` + `sop/render-lib` 到 F: 可解析布局；重启 Gateway。  
3. 在库存查询 / 报表查询成功路径上：`sealAndRender` → `prepareWecomRender` / outbound **image**（勿把路径打进用户可见文本）。  
4. 负例：伪造 datasetRef、跨用户 ref、未绑定。  
5. 真人企微 PC/手机打开图片；金额与 ERP 对账。  
6. 标记：`LOCAL_DEPLOYED` + `LIVE_UAT`（仅图片通道）。

然后：

- **020B**：原生卡片，多商品名称/数量/单价/行金额/合计。  
- **020D**：本月采购/销售/库存/伙伴总览；销售未接入则显示「未接入」；**不做 H5**。

任务卡：`docs/poc/queue/AIERP-020B.md`、`AIERP-020C.md`、`AIERP-020D.md`。  
架构：`docs/poc/RICH_CHANNEL_RENDERING_AND_AUDIT_ARCHITECTURE.md`。

### 5.3 用户可测自然语言（部署对齐后）

- 「绑定 ERP」→ 按提示 claim。  
- 「查原料仓表面活性剂还有多少」。  
- 「给我采购模板」→ 上传 Excel → 预览草稿 → 本人确认短语。  
- （020C 接线后）「用表格/柱状图展示刚才库存/本月采购汇总」。

---

## 6. 交接验收（本轮实际执行）

| 检查 | 结果 |
|---|---|
| `git fetch origin master` / `origin/master=0614a394` | **成功** |
| 干净 worktree 检出 master | **成功**（`D:\ERP\ai-erp-handoff`） |
| Docker `aierp-boot/mysql/redis` 运行 | **成功** |
| Host/Container JAR SHA 一致 | **成功**（`5995bcb5…`） |
| Gateway `/health` 200 live | **成功** |
| Boot HTTP（login/doc） | **成功**（doc 探针偶发 404，以本次 200 为准） |
| F: 插件存在且 Gateway 加载 | **成功**（进程在跑） |
| F: 对齐 `0614a394` | **失败**（index hash 不一致；无 render-lib） |
| `verify-demo-release.ps1` 整体 | **NOT_VERIFIED**（checkout≠master；曾报 doc 404） |
| Maven clean 全量重编 | **本交接未执行**（避免无必要改运行态） |
| 真人企微发图 UAT | **未验证** |
| 020B/022A/主数据分支合并 | **未做** |

---

## 7. 给下一任的最短路径

1. 读本文 + `deploy/openclaw/README.md`。  
2. 用干净目录对齐 `origin/master`。  
3. 备份后同步插件/`render-lib`，重启 Gateway，跑 `verify-demo-release.ps1` 至插件对齐。  
4. 实现 020C 企微图片发送并 UAT。  
5. 再 020B → 020D。  
6. 任何时候保持：**单任务、单运行态、SSH Git、密钥不进库**。

---

*本文由 Cursor 在停止新功能开发时根据 GitHub `0614a394` 与本机 Windows 实测写入；后续部署指纹以 Workbuddy 新一次 `verify-demo-release.ps1` 为准。*
