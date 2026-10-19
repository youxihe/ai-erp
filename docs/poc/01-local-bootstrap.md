# AIERP-001 · 本地 jshERP 基线部署说明

> 独立命名空间：本仓库专用 Docker 容器 `aierp-mysql` / `aierp-redis` / `aierp-boot`。  
> 端口只绑定 `127.0.0.1`：MySQL `13306`，Redis `16379`，后端 `9999`。不向局域网或公网开放。  
> 若以后需要局域网访问，必须单独做认证与授权，不能带着默认演示密码暴露。

## 1. 环境检查结果（本机实测）

| 组件 | 要求 | 本机结果 |
|---|---|---|
| Node.js | 20+ | **已有** v22.16.0 / npm 10.9.2 |
| Docker Desktop | 可用 | **已有** 28.3.3（需先启动 Docker Desktop） |
| JDK 8 | 本机 | **缺失** → 用 Docker 镜像 `maven:3.9.6-eclipse-temurin-8` / `eclipse-temurin:8-jre` 构建运行 |
| Maven | 本机 | **缺失** → 同上容器构建；可选缓存于 `.tools/apache-maven-3.9.6`（不提交） |
| MySQL 8 | 本机服务 | **缺失** → `aierp-mysql` 容器 |
| Redis 6 | 本机服务 | **缺失** → `aierp-redis` 容器（**未**使用 `moxiang-redis:6379`） |

## 2. 一键启动 / 停止

```powershell
# 首次：复制环境变量模板（勿提交真实密钥）
copy deploy\.env.example deploy\.env

# 启动 MySQL + Redis + Boot（含镜像构建）
powershell -File deploy\scripts\start-all.ps1

# 仅种子 PCB 主数据（可重复执行）
powershell -File deploy\scripts\seed-demo.ps1

# 前端（另开终端）
cd jshERP-web
npm install --legacy-peer-deps --registry=https://registry.npmmirror.com
npm run serve

# 业务基线验收（真实 API + 审核前后库存）
node deploy\scripts\baseline-flow.mjs

# 停止（保留数据卷）
powershell -File deploy\scripts\stop-all.ps1
```

### URL / 账号

| 项 | 值 |
|---|---|
| 前端 | http://localhost:3000/ |
| 后端 API / Swagger | http://127.0.0.1:9999/jshERP-boot/doc.html |
| 租户账号 | `jsh` / `123456`（仅本机演示；接入非 loopback 前请在系统里改密） |
| 超管账号 | `admin` / `123456`（同上，不要带到公网） |
| MySQL | `127.0.0.1:13306` / db `jsh_erp` / root 见 `deploy/.env` |
| Redis | `127.0.0.1:16379` / 密码见 `deploy/.env` |

原生初始化 SQL：`jshERP-boot/docs/jsh_erp.sql`（由 MySQL 容器首次启动自动导入）。  
PCB 演示主数据：`deploy/sql/02-pcb-demo-master.sql`（**只写主数据**，不直接改库存余额，也不改验证码开关）。

种子前提：只适用于 `jshERP-boot/docs/jsh_erp.sql` 导入后的上游演示库，且 `jsh_user.id=63 / login_name=jsh / tenant_id=63`。`seed-demo.ps1` 与 SQL 过程都会先检查该身份，对不上则拒绝执行。仓库改名只在名称仍为上游样例 `仓库1`/`仓库2` 或已经是演示名时发生；已有条码的物料第二次执行会跳过。

本地配置覆盖：`jshERP-boot/src/main/resources/application-local.yml`（`spring.profiles.active=local`）。

## 3. 演示主数据（租户 63 / jsh）

| 类型 | 内容 |
|---|---|
| 仓库 | `原料仓`(id=14)、`成品仓`(id=15) |
| 供应商 | 华东化工、华南助剂 |
| 客户 | 苏州精密电子、华北电子科技 |
| 物料 | RM-A001 / RM-B002 / RM-C003 / FG-101 / FG-102 |
| 系统 | `force_approval_flag=1`（强制审核后才改库存，便于验收） |

## 4. 实测结果（真实 API，非 poc/index.html）

首轮证据：`docs/poc/evidence/baseline-20261019172847.json`。  
Review 修复后复测：`docs/poc/evidence/baseline-20261019174403.json`（12 条断言全部 pass，退出码 0；验证码开关测前测后均为 `1`）。

| 步骤 | 单据号 | 审核前库存 | 审核后库存 | 结论 |
|---|---|---:|---:|---|
| 采购入库 表面活性剂 80L | `POC-PI-20261019172847` | RM-A001 = **80** | RM-A001 = **160**（Δ+80） | 未审核不改库存；审核后入库 |
| 组装配制 FG-101 100L（A60/B10/C30，虚构配比） | `POC-MIX-20261019172847` | A=160, FG=0 | A=**100**, FG=**100** | 审核后原料减、成品增 |
| 其它出库（服务耗料）20L | `POC-SV-20261019172847` | FG-101 = **100** | FG-101 = **80**（Δ-20） | 审核后出库 |

最终余额（同次跑批）：RM-A001=100，RM-B002=10，RM-C003=20，FG-101=80。

登录 API（MD5 密码）已验证：`POST /user/login` → `msgTip=user can login`。  
前端只确认 `npm run serve` 后 http://localhost:3000/ 返回页面（HTTP 200）。没有逐页人工点验采购/组装/出库界面；单据与库存验收以 API 基线脚本为准。

`baseline-flow.mjs` 在断言失败时退出码非 0，并写入失败证据。连接 `127.0.0.1` 时会临时把 `checkcode_flag` 设为 `0` 以便无界面登录，结束后恢复原值；设置 `AIERP_CAPTCHA_TEST_BYPASS=0` 可关闭该测试模式。种子脚本不会改这个开关。若本机曾被旧种子关掉验证码，可执行：

```sql
UPDATE jsh_platform_config SET platform_value='1' WHERE platform_key='checkcode_flag';
```

## 5. 清理 / 重建

```powershell
cd deploy
docker compose down -v          # 删除容器与数据卷
docker compose --env-file .env up -d --build
powershell -File scripts\seed-demo.ps1
node ..\deploy\scripts\baseline-flow.mjs
```

## 6. 风险与剩余项

- 本机未装原生 JDK/Maven；完全依赖 Docker 构建后端。若需 IDE 本机调试，需自行安装 JDK8 + Maven。
- 上游 `pom.xml` 将 `maven-compiler-plugin` 设为 `skip=true`；Docker 构建通过 `-Dmaven.compiler.skip=false` 强制编译。
- 演示配制比例为**虚构数据**，不可用于真实工艺。
- `deploy/.env` 仅本地使用，已加入 `.gitignore`；仓库只保留 `.env.example`。
- 容器端口只监听 loopback。默认账号 `jsh`/`admin` 密码 `123456` 仅用于本机演示。
- 未自行 Merge；后续 Excel/AI 任务仍为 BLOCKED，待 ChatGPT Review 后释放。
