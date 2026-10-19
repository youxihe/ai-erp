# PCB 清洗企业 · AI 进销存 POC

> 第一版定位：**用于业务调研的轻量交互 Demo**，而不是正式上线的 ERP 或已接通的企业微信机器人。
> 仓库仍以 jshERP 为业务底座；本目录目前独立运行，用于验证 AI 操作路径、业务闭环、交互和客户反馈。

## 1. 快速启动

环境：Node.js 20 或更高版本（仅使用原生模块，无需 npm install）。

在仓库根目录执行：

```bash
node poc/server.mjs
```

打开 **http://127.0.0.1:4173**。

也可以直接用浏览器打开 `poc/index.html`：所有业务交互仍可使用，但不能连接真实语言模型。

界面布局适配 PC 和手机；尚未接入企微自建应用鉴权或企微 AI 机器人。

### 可选：启用真实语言模型进行意图解析

POC 默认使用**本地规则模拟意图解析**。未配置密钥时，页面不会伪称已经调用 AI 模型。

服务端读取环境变量，不在网页中放入 API Key。

macOS / Linux：

```bash
export AI_API_KEY="your-key"
export AI_MODEL="your-model"
export AI_BASE_URL="https://your-openai-compatible-endpoint/v1"
node poc/server.mjs
```

Windows PowerShell：

```powershell
$env:AI_API_KEY = "your-key"
$env:AI_MODEL = "your-model"
$env:AI_BASE_URL = "https://your-openai-compatible-endpoint/v1"
node poc/server.mjs
```

在页面右侧点击「检测真实模型」，连接成功后大模型仅执行**意图/参数解析**。页面的模拟库存变更始终经过“生成草稿 → 人工确认 → 更新本地模拟台账”流程。

> 模型接口需兼容 `/chat/completions`；暂未兼容其他协议。模型 API Key 仅供本地演示，请勿提交到 Git。
> 对话内容使用该模式时会发送至所配置的模型提供方。**不要导入客户真实机密配方或敏感数据。**

## 2. 演示脚本（5 分钟）

1. 「哪些物料库存不足？」→ 返回当前库存和安全线。
2. 「采购入库表面活性剂80升」→ AI 生成入库草稿 → 点「确认模拟过账」→ 库存增加。
3. 「配制100升PCB清洗液」→ 按虚构示例配比计算：表面活性剂60L、络合剂10L、纯水30L → 确认 → 三种原料扣减、清洗液增加100L。
4. 「苏州精密电子清洗服务使用PCB清洗液20升」→ 关联客户与药水 → 确认 → 成品药水减少20L，新增演示耗料记录。
5. 「分析一下经营数据」→ 返回本次浏览器中的业务统计。左侧可切换原料库存、配方和业务流水。

可在「原料与药水」页面重置数据并重复演示。浏览器 localStorage 只保存**当前演示库存及本地模拟业务单据**。

## 3. 已实现与尚未实现

| 能力 | POC v0（当前） | 后续真实集成 |
|---|---|---|
| PC/手机业务工作台 | 有，静态自适应 H5 | 企微自建应用入口、企微授权 |
| 意图识别 | 本地规则；可切换到服务端 LLM | 工具调用、服务端统一状态和权限 |
| 采购入库 | 本地模拟草稿及确认、库存增减 | jshERP 采购入库单 |
| 清洗药水配制 | 虚构配方计算，原料减、药水增 | jshERP 组装单；核验物料行和审核影响库存 |
| 服务耗料 | 本地模拟客户和药水耗用 | jshERP 其它出库；必要时增加轻量服务工单关联 |
| 库存及预警 | 浏览器模拟台账 | jshERP 真实库存及仓库权限 |
| 经营统计 | 本次模拟业务统计，预置样例趋势 | ERP 真实聚合查询 |
| 持久化 | localStorage | jshERP MySQL |
| 企业微信 Bot | 未接入 | 企业微信官方 AI Bot SDK / OpenClaw 适配 |

**当前没有接入真实 jshERP API。** 当前模拟业务没有写入 jshERP MySQL，不能用于实际采购、生产、清洗作业或账务管理。

### 配方注意事项

示例配比是为了展示软件闭环而编造的**非生产级数据**，与化学品实际配制流程、相容性和安全要求无关。不可按演示配方进行任何实际化学操作。所有金额是模拟单价，服务耗材成本不包含设备折旧、人工、能耗等，不能当作完整毛利。

## 4. 与已克隆 jshERP 的实际映射

已在 `master` 源码确认：

| 场景 | 原生页面 | `type` / `subType` | 源码 |
|---|---|---|---|
| 采购原料 | 采购入库单 | `入库` / `采购` | `jshERP-web/src/views/bill/modules/PurchaseInModal.vue` |
| 配制药水 | 组装单 | `其它` / `组装单` | `jshERP-web/src/views/bill/modules/AssembleModal.vue` |
| 清洗服务耗料 | 其它出库单 | `出库` / `其它` | `jshERP-web/src/views/bill/modules/OtherOutModal.vue` |

单据统一通过 `jshERP-boot/src/main/java/com/jsh/erp/controller/DepotHeadController.java` 中的 `POST /depotHead/addDepotHeadAndDetail` 处理，入参有 `info` 与 `rows` 两层 JSON 字符串。

**注意**：当前 POC 没有直接拼装请求写入该接口。正式适配必须先跑通原生页面，核验物料 SKU/仓库/数量字段、组装单 `mType` 子项、库存检查、审核/反审核与权限机制，不可直接通过 SQL 更新库存，也不可将两条普通出入库调用当成原子配制事务。

### 建议的后续集成层

`WeCom AI Bot → Agent Gateway（意图 / 工具白名单 / 企微身份映射）→ jshERP Service`

`WeCom 自建应用 H5 → 业务 API → jshERP Service`

仅暴露五个受控工具：`stock.query`、`purchase.createDraft`、`mix.createDraft`、`service.createDraft`、`report.summary`。写操作永远是草稿、校验、确认、正式过账，不允许 LLM 直接执行数据库 SQL。服务端校验租户、用户、仓库权限、库存可用量和幂等键。

后续是否需要采购供应商、配方版本、批次和服务工单，优先在本次 Demo 评审时确认，不在 POC 中先行扩展业务模型。

## 5. 代码结构

- `poc/index.html`：自包含的 PC/H5 页面、规则演示、浏览器模拟库存。
- `poc/server.mjs`：Node 原生 HTTP 服务、可选大模型意图解析代理。
- `poc/check.mjs`：零第三方依赖的 POC 基础检查。

POC 不改动 jshERP 的原始前后端源码、数据库、配置及菜单，避免影响后续原生功能验收。
