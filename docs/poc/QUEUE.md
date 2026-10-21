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
| AIERP-013 | **DONE / PR #21** | 物料、客户供应商、单据明细、经营查询；跨仓混合单据权限修复通过，23/23 PASS |
| AIERP-014D | **DONE / PR #22** | **可信原始消息确认、草稿挑战、显式 ERP actor 设计已 Review + Merge** |
| **AIERP-015A** | **REVIEW_FIX_REQUIRED / PR #24 · next_order #1** | 采购 DRAFT 后端 14/14 PASS；待合并 013+015A 工具、验证企微真实调用和草稿按企微身份隔离 |
| AIERP-015B | PLANNED / after 015A security Review | 企业微信可信确认事件或 ERP 登录确认 → 原生审核过账，严格身份委托 |
| AIERP-016 | PLANNED | 配制/服务耗料多轮草稿与确认；复用 015 通用确认协议 |
| AIERP-017 | PLANNED | Excel 企微文件接入、业务异常处理；图片/Excel/H5 报表按渠道能力降级 |
| AIERP-018 | PLANNED | 多企微身份、不同 ERP 仓库权限/租户 UAT 与渠道安全收口 |
| AIERP-012B | SUPERSEDED by 013–017 | 分拆为查询、确认协议、业务写入、文件及报表能力 |
| AIERP-006 | BACKLOG | 企微 H5/报表消息增强，等 011/012 基线通过 |
| AIERP-007 | SUPERSEDED by 011 | OpenClaw 安装与企微基础接入由 AIERP-011 承接 |

## 2026-10-21 新阶段：从库存问答到业务流程 Agent

**当前队列与开工顺序**：
1. **AIERP-013 / PR #21 已 DONE**：已合入 master，Query Tool 包含物料、供应商/客户、单据、汇总。服务器侧按有权仓库整单可见性保护金额，23/23 PASS，双真人身份 UAT 未完成。
2. **AIERP-014D / PR #22 已 DONE**：可信确认设计已获 Review。
3. **AIERP-015A / PR #24 REVIEW_FIX_REQUIRED**：后端显式绑定 ERP 用户 DRAFT 14/14 PASS，但独立旧分支的 OpenClaw plugin/alsoAllow 仅含 4 基础+3 草稿工具，遗漏已合并 013 的 5 个查询工具；用户实际企微会话报告 prepare 尚未加载。先将原 #24 分支 rebase 最新 master、合并为 **12 个工具**，确保 F: 真实 Agent 现用会话可见和调用，并修复草稿 WeCom sender/binding version 隔离。确认不属此阶段，015B 仍 PLANNED。
4. Cursor 不自行 Merge / 不主动释放 015B/016/017。

详细见 `docs/poc/queue/AIERP-015A.md` 及已合并 ADR `docs/poc/adr/AIERP-014D-conversational-confirmation.md`。

AIERP-011/012A 已完成：本机 Windows native `F:\\aierp-openclaw`，DeepSeek + WeCom WS 私聊工作；**双真实企微身份 + 不同仓库权限 UAT 仍 NOT_VERIFIED**。

### 013 查询范围
- 查询主数据：物料/编码/单位、供应商/客户，按用户租户和真实业务权限。
- 查询业务单据：最近采购入库、组装配制、服务耗料；筛选日期/状态/关键字、查看单据明细。**单据须全部明细仓库均在用户授权范围内才可见表头/金额**。
- 查询统计：真实后端聚合；不允许 AI 编造报表数字。
- 企微简单答案在聊天框显示；复杂结果先做结构化摘要；图片/H5 由 017 实施。

### 014D / 015 写操作设计闸门
OpenClaw **不得**暴露管理员会话或新增可由模型任意调用的 confirm Tool。015A 只允许绑定用户创建不改库存的 DRAFT；正式入账属 015B。

当前 POC 只能承诺本机对话和 Demo。严禁修改 HR 项目、向 Git 上传真实 Secret；暂不安装新 OpenClaw。Cursor 每任务 push + 测试后由 ChatGPT Review/Merge，不能自行 Merge。
