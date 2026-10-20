# AI-ERP POC · Demo-first Delivery Queue

> **唯一工作域**：`youxihe/ai-erp`，与所有 HR/HCM 及其它项目完全隔离。

## 2026-10-20 交付状态

| ID | 状态 | 说明 |
|---|---|---|
| AIERP-001 | **DONE / PR #3** | 独立本地 jshERP 基础环境 |
| AIERP-003 | **DONE / PR #5** | 真实原生采购、组装、服务耗料网关及权限幂等 |
| AIERP-002 | **DONE / PR #7** | XLSX 下载、解析、预览、人工确认、回执 |
| AIERP-005 | **DONE / PR #8** | PC/H5 演示工作台基础入口 |
| AIERP-004 | **DONE / PR #10** | 规则型助手与 ERP 实时库存查询 |
| AIERP-008 | **DONE / PR #12** | PC Demo 集成；17/17 脚本验收、本机浏览器三链路操作；**H5 尚未验收通过** |
| AIERP-009 | **DONE / PR #14** | PC 确认状态、库存与单据排版收口；H5 遮罩已改善，最终补丁的手机点击回归待确认 |
| AIERP-010 | PLANNED | 首页库存按仓库分组、名称与编码并显；非阻断小任务 |
| AIERP-011 | **DONE / PR #17** | Windows native（F:）、DeepSeek 真实回复、企微 WS；启动/运维 Review Fix 已通过 |
| AIERP-012A | **DONE / PR #19** | 可信企微用户绑定 ERP，HMAC/nonce/权限重验，真实库存查询；单用户端到端成功，双用户权限 UAT 待补 |
| **AIERP-013** | **REVIEW_FIX_REQUIRED / PR #21 · next_order #1** | **19/19 本地通过，跨仓混合单据存在表头整单金额权限泄漏，需一次小修复** |
| AIERP-014D | **DONE / PR #22** | **可信原始消息确认、草稿挑战、显式 ERP actor 设计已 Review + Merge** |
| **AIERP-015A** | **RELEASED / next_order #2** | **企微多轮采购信息收集与真实 DRAFT；后续 015B 再开放可信确认** |
| AIERP-015B | PLANNED / after 015A security Review | 企业微信可信确认事件或 ERP 登录确认 → 原生审核过账，严格身份委托 |
| AIERP-016 | PLANNED | 配制/服务耗料多轮草稿与确认；复用 015 通用确认协议 |
| AIERP-017 | PLANNED | Excel 企微文件接入、业务异常处理；图片/Excel/H5 报表按渠道能力降级 |
| AIERP-018 | PLANNED | 多企微身份、不同 ERP 仓库权限/租户 UAT 与渠道安全收口 |
| AIERP-012B | SUPERSEDED by 013–017 | 分拆为查询、确认协议、业务写入、文件及报表能力 |
| AIERP-006 | BACKLOG | 企微 H5/报表消息增强，等 011/012 基线通过 |
| AIERP-007 | SUPERSEDED by 011 | OpenClaw 安装与企微基础接入由 AIERP-011 承接 |

## 2026-10-21 新阶段：从库存问答到业务流程 Agent

**当前队列与开工顺序**：
1. **AIERP-013 / PR #21**：先修复混合仓库单据表头整单金额泄漏，Push `REVIEW_FIX_PUSHED`；由 ChatGPT Review/merge。19/19 现有本地断言仅证明单用户逻辑，不等于不同权限用户 UAT PASS。
2. **AIERP-014D / PR #22 已 DONE**：可信确认设计已获 Review，并加严为“独立可信 WeCom 入站原始事件 + 全业务调用链显式 ERP actor”；禁止构造 ERP 假 session、借管理员 Token。
3. **AIERP-015A 已 RELEASED**：013 修复分支 Push 后可以独立**准备采购槽位收集/后端 DRAFT 实现**，但必须基于最新 master 的独立分支，避免提前复制 013 的未合并功能。013 合并后再 rebase 和集成读查询工具。未通过显式身份审计前不能模拟登录或造假 DRAFT。**OpenClaw 绝不增加可由模型调用的 confirm 工具**。015B 真正过账仍为 PLANNED。
4. 015A 完成、测试、push 后回到 ChatGPT Review；Cursor 不自行 Merge/不主动释放 015B/016/017。

详细见 `docs/poc/queue/AIERP-015A.md` 及已合并 ADR `docs/poc/adr/AIERP-014D-conversational-confirmation.md`。

AIERP-011/012A 已完成：本机 Windows native `F:\\aierp-openclaw`，DeepSeek + WeCom WS 私聊工作；当前 AI 工具只支持账号绑定和真实库存查询。用户已实测 1 个已绑定 ERP 用户的真实库存，`AIERP-012A` 新证据 17/17 PASS；**双真实企微身份 + 不同仓库权限 UAT 仍 NOT_VERIFIED**，因此不要宣称正式多用户上线准备完成。

### 013 查询范围
- 查询主数据：物料/编码/单位、供应商/客户，按用户租户和真实业务权限。
- 查询业务单据：最近采购入库、组装配制、服务耗料；筛选日期/状态/关键字、查看单据明细，正确中文类型、审核状态与仓库。
- 查询统计：真实后端按日期区间、客户、物料聚合数量/金额，若当前 ERP 没有所需数据必须提示“不支持/数据不足”，**不允许 AI 编造报表数字或自行汇总无权限行**。
- 企微简单答案在聊天框显示；复杂结果先做结构化摘要/Excel 输出适配建议，图片/H5 由 017 实施，先别开发公网穿透。
- 首页物料名称 + 编码 + 仓库分组的小优化 AIERP-010 可随 013 的前端同域变更**捎带**；不在本轮扩大 UI 版图。

### 014D / 015 写操作设计闸门
现有 `/purchase/draft`、`/mix/draft`、`/service/draft`、`/draft/confirm` 和 Excel API 可复用。但**OpenClaw 不得直接暴露现有管理员会话或新增可由模型任意调用的 confirm Tool**。确认必须由真实企微私聊事件/可信卡片回调或 ERP H5 已登录用户动作产生单次、绑定草稿的服务器确认凭据。014D ADR 已通过 Review；015A 只允许通过显式绑定用户创建不改库存的 DRAFT，正式入账的 015B 待独立安全审查和可信事件验证。

当前 POC 只能承诺本机对话和 Demo，不代表生产化。严禁修改 HR 项目、向 Git 上传真实 Secret/用户聊天记录；暂不安装新 OpenClaw 或迁回 WSL/Docker。已合并的采购、配制、耗料真网关不得重构。Cursor 每任务 push + 测试 + READY_FOR_REVIEW 之后按队列接力，不能自行 Merge。
