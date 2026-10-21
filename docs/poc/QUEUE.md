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
| AIERP-015A | **DONE / PR #24** | 企业微信真实生成采购 DRAFT #106，12 工具集成；25/25 本地测试，未入库 |
| **AIERP-015B** | **REVIEW_FIX_REQUIRED / PR #27 · next_order #1** | **已验证企微采购 #111 原生过账及文字回执；修复 UI fallback 旧绑定确认和 PDF 下载撤权后权限** |
| **AIERP-019A** | **RELEASED / next_order #2 (docs-only)** | **ERP 受控 API 能力目录/OpenAPI 子集、OpenClaw SOP Skills、通用工具方案设计** |
| AIERP-019B | PLANNED / after 019A reviewed + 015B merged | 受控能力发现/查询/草稿的动态 Tool Adapter MVP；不新增模型 confirm 工具 |
| AIERP-015C | PLANNED / after 015B | 企微 PDF 附件发送实测、回执再次领取、确认指令标点兼容 |

| AIERP-016 | PLANNED | 配制/服务耗料多轮草稿与确认；复用 015 通用确认协议 |
| AIERP-017 | PLANNED | Excel 企微文件接入、业务异常处理；图片/Excel/H5 报表按渠道能力降级 |
| AIERP-018 | PLANNED | 多企微身份、不同 ERP 仓库权限/租户 UAT 与渠道安全收口 |
| AIERP-012B | SUPERSEDED by 013–017 | 分拆为查询、确认协议、业务写入、文件及报表能力 |
| AIERP-006 | BACKLOG | 企微 H5/报表消息增强，等 011/012 基线通过 |
| AIERP-007 | SUPERSEDED by 011 | OpenClaw 安装与企微基础接入由 AIERP-011 承接 |

## 2026-10-21 13:19 · Agent 产品架构升级（暂不实施通用写操作）

用户确认核心业务体验后同意改为 **OpenClaw 自主业务编排 + 受控 ERP API 能力目录 + 场景 SOP Skills**，避免每个业务重复开发独立工具。原则：AI 可以自由查询和决定编排计划，**绝不自由调用未授权 URL/SQL/写接口，且正式过账确认不能成为模型 Tool**。

**并行队列**：
1. **#27 / 015B**：真实企微 #111 本人回复 `确认采购111` → 原生审核 `GW-PURCHASE-111`，RM-A001 原料仓库存 160.7→170.7 L（+10），文字回执已回；PDF `PDF_GENERATED` 但企微附件尚未验证。针对发现的两项权限问题执行窄范围 `REVIEW_FIX`，不重构整个事务链。
2. **019A / docs-only**：可独立从最新 master 新分支开始，整理现有已实现 API 的 **审定能力目录（operationId + JSON Schema + required permission + data scope + sideEffectLevel + user-confirmation requirement）**、SOP Skills 和通用 Agent Gateway 设计/验收；**不得合入 015B 分支或接入运行态**，避免影响真人企微。
3. **019B / 暂未 RELEASED**：等 019A 设计 Review 和 #27 merge 之后再实施最小动态发现/只读查询/真实草稿 Adapter。确认业务仍走 015B 的独立可信企微原始事件管道。
4. **015C / 暂未 RELEASED**：专注 PDF 企微附件发送/下载的产品体验与“确认采购：111”安全规范化，不能改变原生入库事务。

详细见 `docs/poc/AGENT_CAPABILITY_ARCHITECTURE.md`、`docs/poc/queue/AIERP-019A.md`。Cursor 仍不自行 Merge，OpenClaw 实例在 `F:\\aierp-openclaw`，禁止新装/升级。正式生产多用户双权限 UAT 仍 `NOT_VERIFIED`。

## 2026-10-21 新阶段：从库存问答到业务流程 Agent

**当前业务链 PR #27 开发修复（015B）；另已释放 019A docs-only 并行设计任务。** AIERP-015A PR #24 已按 Review 通过并合并；25/25 单机自动化及用户提供的真实企微草稿 #106 对话证明只做 DRAFT 这一段可用，不代表确认已经开发。新任务目标是**企微本人明确确认 → 原生采购入库 → 返回已审核单号/实际库存变化 → 发送业务回执，优先 PDF 附件**。

确认必须独立于 LLM Tool，依据可信企微私聊原始消息事件（不需要用户登录传统 ERP 来“确认”才算理想成功）；若当前官方 Channel 无法暴露可验证的原始事件，必须报告 `BLOCKED_TRUSTED_CONFIRM_EVENT`，并提供已登录 ERP PC/H5 的真实确认保底链路，**不得伪造事件/Session/管理员账号**。

**先修绑定代际的秒级碰撞**：原 015A 草稿所有权使用 `bound_at` DATETIME(0)，同一秒内解绑重绑无法唯一判别。015B 增加服务端单调 `binding_version`（原子递增）或独立唯一 generation，确认、取消、查询均绑定同一 generation。完整任务、回执/PDF合同与测试见 `docs/poc/queue/AIERP-015B.md`、`docs/poc/15b-receipt-contract.md`。

Cursor 从最新 `origin/master` 开 `feat/aierp-015b-trusted-confirm-receipt`，分阶段 Push、真实验收；不自行 Merge。015B 未通过之前不自动启动 016（配制/服务耗料）、017（Excel/报表）。**不得自动入账已有草稿 #106 或任何用户实际待处理草稿**；使用专门测试草稿并经用户真实确认。

详细见 `docs/poc/queue/AIERP-015A.md` 及已合并 ADR `docs/poc/adr/AIERP-014D-conversational-confirmation.md`。

AIERP-011/012A 已完成：本机 Windows native `F:\\aierp-openclaw`，DeepSeek + WeCom WS 私聊工作；**双真实企微身份 + 不同仓库权限 UAT 仍 NOT_VERIFIED**。

### 013 查询范围
- 查询主数据：物料/编码/单位、供应商/客户，按用户租户和真实业务权限。
- 查询业务单据：最近采购入库、组装配制、服务耗料；筛选日期/状态/关键字、查看单据明细。**单据须全部明细仓库均在用户授权范围内才可见表头/金额**。
- 查询统计：真实后端聚合；不允许 AI 编造报表数字。
- 企微简单答案在聊天框显示；复杂结果先做结构化摘要；图片/H5 由 017 实施。

### 014D / 015 写操作设计闸门
OpenClaw **不得**暴露管理员会话或可由模型凭自填 draftId 即执行的 confirm Tool。015A 已完成不改库存的 DRAFT；015B 负责从**真实企微原始确认事件**或者已登录 ERP 用户提交动作触发原生过账，并生成已审核单据回执。

当前 POC 只能承诺本机对话和 Demo。严禁修改 HR 项目、向 Git 上传真实 Secret；暂不安装新 OpenClaw。Cursor 每任务 push + 测试后由 ChatGPT Review/Merge，不能自行 Merge。
