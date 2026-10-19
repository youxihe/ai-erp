# PCB 清洗 AI-ERP POC · 方案与交付界限

## 业务范围

客户 30–50 人，过去使用 Excel，没有原生 ERP。业务包括**采购原料、自行调配药水、提供 PCB 清洗服务并消耗自产药水**。设备/药水销售先维持 jshERP 现有销售单，重点先演示清洗剂。

核心真实单据链：采购入库（原料增加）→ 组装单（原料减少、药水增加）→ 其它出库（客户服务耗料）→ 真实库存、采购和耗用查询。**先用演示物料与虚构配比，不做正式 BOM、危化品工艺或批次超出原生范围的模型。**

## 架构

```text
AI 交互入口                             可视化入口
 ├─ PC / H5 对话                         ├─ PC 经营看板
 ├─ 下载场景 Excel                       └─ 手机 H5 业务确认
 └─ 上传 Excel / 多轮校验                      │
                │                            │
                └──────────┬─────────────────┘
                           ▼
               Agent 业务网关（轻量）
               - 模型意图 / 表格解析结果
               - 严格的字段 & 工具 schema
               - 身份/租户/仓库权限
               - 草稿→人工确认→幂等执行
                           │
                      jshERP Service
           ┌───────────────┼────────────────┐
        采购入库         组装单          其它出库
           └───────────────┼────────────────┘
                 jshERP MySQL / Redis
```

## AI Agent：暂不引入 OpenClaw 作为核心

**当前建议：** 先使用后端服务 + LLM function/tool calling + **白名单工具**（`stock.query`、`purchase.createDraft`、`mix.createDraft`、`service.createDraft`、`excel.generateTemplate`、`excel.parsePreview`、`draft.confirm`、`report.summary`）。固定契约能让 PC/H5、企微 AI Bot 和未来 OpenClaw 共用同一业务层。

**第二阶段企微：** 可先用官方 `@wecom/aibot-node-sdk` 实现智能机器人长连接、文件收发和卡片；企业微信自建应用负责 H5、身份和确认，避免提前运行 OpenClaw 的系统工具权限。

**何时值得上 OpenClaw：** 需要多轮跨工具自动化、企微渠道/技能生态、复杂文档处理和通知时，再用 OpenClaw 做*渠道或编排层*，只允许访问白名单业务 API；禁止其数据库直连、Shell 执行、文件系统任意读写。OpenClaw 接入不改变库存事务和人工确认逻辑。

OpenClaw 官方的 Gateway API 是可信操作员权限域；不要把带 shell 权限的 Gateway 直接暴露给企微用户，更不能把 Gateway Token 当作每个员工的业务身份。参考：
- https://docs.openclaw.ai/gateway/tools-invoke-http-api
- https://docs.openclaw.ai/tools/exec/index.html
- https://github.com/WecomTeam/aibot-node-sdk

## 原生 jshERP 核心接口（已读仓库源码，尚未做本地运行验证）

| 业务 | UI 源码 | 原生 type/subType |
|---|---|---|
| 采购入库 | `jshERP-web/src/views/bill/modules/PurchaseInModal.vue` | `入库 / 采购` |
| 组装配制 | `jshERP-web/src/views/bill/modules/AssembleModal.vue` | `其它 / 组装单` |
| 服务耗料 | `jshERP-web/src/views/bill/modules/OtherOutModal.vue` | `出库 / 其它` |

统一单据提交 `POST /depotHead/addDepotHeadAndDetail`，但**不能只凭 API 名称断定成功提交就立即改变可用库存**；必须核对审核与组装逻辑和交易原子性。

## 阶段展示里程碑

- **M1：** 本地 jshERP 登录、原生业务单、演示数据可用。
- **M2：** AI 发/收 Excel，逐行解析/错误提示/下载回执/确认页，确认后真实 jshERP 单据和库存更新。
- **M3：** 对话自然语言生成业务草稿；PC / 手机 H5 查看真实数据与下载文件。
- **M4（用户配合配置）：** 企业微信机器人及自建应用；OpenClaw 仅在评估后作为可选增强。

**功能深度原则：** 尽量不改 jshERP 库存核心，不铺开完整生产管理、财务总账、复杂多级审批。