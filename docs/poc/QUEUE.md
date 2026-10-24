# AI-ERP POC · Demo-first Delivery Queue

> 最新交付机制：`docs/poc/FAST_DEMO_DELIVERY.md`。业务开发/本机 Demo 发布/UAT/Review 并行，历史「必须 PR Merge 才能本机预览」以本机制为准。

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
| AIERP-015B | **DONE / PR #27** | **企微本人确认 → 原生审核 GW-PURCHASE-111 / +10 L；Session 旧绑定及 PDF 下载权限修复，18/18 PASS；PDF 企微送达尚未验收** |
| AIERP-019A | **DONE / PR #31** | **ERP 受控 API 能力目录 + SOP Skills + 通用网关设计已 Review / Merge** |

| **AIERP-020D** | **PLANNED / AFTER 020B** | **企微经营总览：本月采购/销售、库存、供应商/客户统计；复用真实 ERP 指标+020C 图表，无 H5** |
| **AIERP-020B** | **PAUSED / NEXT AFTER 020C** | **企业微信模板卡片与多明细商品数量单价金额：实测 SDK 原生 card/Markdown/image/file，PC/手机截图，拒 text HTML/MEDIA** |
| **AIERP-020C** | **ACTIVE / PR #50 REVIEW_FIX_REQUIRED** | **通用表格图片与图表 PNG：柱/折/饼/变化图模板，OpenClaw 选择模板+可信 ERP 数据集，不编造统计值** |
| **AIERP-022A** | **PAUSED / SEQUENTIAL BACKLOG** | **所有 AI ERP 实际写操作持久审计+PDF 操作回执，先 MIX/SERVICE 及不可变版本化 PDF，再接主数据/批次** |
| **AIERP-022B** | **PAUSED / SEQUENTIAL BACKLOG** | **成功业务自动发送 PDF、历史重发和投递审计；修复动态 mediaLocalRoots 扩大目录风险** |
| **AIERP-020A** | **RELEASED / next_order #6 (SOP/UX)** | **标准业务确定性 SOP 脚本 + 企微 Markdown/卡片渲染规范；015C P0 的 receipt-send 优先，其他按小 PR 渐进** |
| AIERP-019B | PLANNED / after 019A reviewed + 015B merged | 受控能力发现/查询/草稿的动态 Tool Adapter MVP；不新增模型 confirm 工具 |
| AIERP-015C | **DONE / PR #37** | **真实企微已收到 PDF 文件消息（GW-PURCHASE-119）；SOP receipt-send + 自动发送已合并，最新自动发送 / PDF 新排版仍待客户端验收** |

| AIERP-017B2 | **DONE / PR #41 `db13699f`** | 多张采购 Excel → 已审核事实重查、真实多草稿及版本幂等；已入 master，真人多单 UAT 待完成 |
| **AIERP-017C1** | **PAUSED / LATER SEQUENTIAL** | 单个可信批次清单一次确认、逐单幂等原生入库、部分成功与企微真实 XLSX 批次回执；必须先过批次写入安全闸门 |
| AIERP-016M | **DONE / PR #42 `bccd9f52`** | MIX 配方预览/确认/草稿及本人原始确认；已入 master，真人 MIX UAT 待完成 |
| AIERP-016S | **DONE / PR #43 `baefd2a4`** | SERVICE 客户耗料草稿/本人可信确认与真实其它出库；已入 master，真人 SERVICE UAT 待完成 |
| **AIERP-021A** | **PAUSED / PR #44 (preserve WIP)** | 供应商/客户真实主数据增加/修改；尽快整合 master + DB 并发/可信确认负例，可先 Demo 预览 |
| **AIERP-021B** | **PAUSED / PR #45 (preserve WIP)** | 原料/物料真实主数据增加/修改；尽快整合 master + 物料写权限/条码并发负例，可先 Demo 预览 |
| AIERP-021C | PLANNED / after 021A+021B | **缺档挂起采购/配制/耗料→建档后恢复原业务，不要求用户重复讲需求** |
| AIERP-016 | SUPERSEDED by 016M/016S | 配制与客户耗料拆分独立业务交付和 UAT |
| AIERP-017A | **DONE / PR #30** | **真实企微 XLSX 文件收发/解析/预览、必填选填模板、Redis 有效预览保持、禁止猜数建草稿；10/10 + 14/14 PASS** |
| AIERP-017B1 | **DONE / PR #35** | **企微真实 Excel 80 L / ¥1,600 → DRAFT #119 → 原生已审核 GW-PURCHASE-119，库存 170.7→250.7 L；11/11 本地 + 真人 UAT** |
| AIERP-017B | PLANNED / after 017A | **采购入库、配制生产、服务耗料出库批量 DRAFT；销售出库接口差异补齐** |
| AIERP-017C | PLANNED / after 017B + 015B | **批次可信确认 → 原生多单过账 → XLSX/PDF 回执发送** |
| AIERP-017 | SUPERSEDED by 017A–017C | Excel 批量业务成为客户 Demo 核心，不是普通文件功能 |
| AIERP-018 | PLANNED | 多企微身份、不同 ERP 仓库权限/租户 UAT 与渠道安全收口 |
| AIERP-012B | SUPERSEDED by 013–017 | 分拆为查询、确认协议、业务写入、文件及报表能力 |
| AIERP-006 | BACKLOG | 企微 H5/报表消息增强，等 011/012 基线通过 |
| AIERP-007 | SUPERSEDED by 011 | OpenClaw 安装与企微基础接入由 AIERP-011 承接 |

## 2026-10-24 · 最新执行决策：只允许一个 Cursor 开发任务（取代并行规则）

用户明确撤回前一轮“多 Agent 并行开发”的执行偏好：**不再同时启动 020B/020C/022A/022B/#44/#45/017C1**。所有旧文档的“多条独立 Agent 可以同时开发”“四条立即开工”等均为历史，**以本节串行锁为准**；仅允许 ChatGPT 对同一个活跃 PR Review、一个 Cursor Agent 编码、一个共享发布责任人在 CODE_READY 之后验收发布（不得重叠操作同一个 F:/JAR）。

- **ACTIVE = AIERP-020C / GitHub [PR #50](https://github.com/youxihe/ai-erp/pull/50) / tip `7530ea93` / REVIEW_FIX_REQUIRED**。Agent 遵照 PR 最新 ChatGPT Round1 评论继续修数据来源授权和媒体数据隔离。图表功能当前只是 **CODE_READY 的模拟数据 Smoke**，并非已接上 ERP、发送成功或 F: 最新版本。
- **NEXT = AIERP-020B**：仅在 020C 有可靠数据来源保护、Review/Merge、真实图片渲染验收之后，进入企微原生卡片/Markdown/图片文件发送与多明细排版。先别把 020B 原分支直接覆盖运行时。
- **THEN = AIERP-020D（新建）**：基于 020C 可信图表和 020B 真实原生卡片，做无 H5 的本月采购/销售、库存、供应商/客户经营总览。业务事实以 ERP 审核/仓库/数据权限为准；销售数据未接入不能伪造。
- **LATER 依次逐棒**：022A 审计/不可变 PDF → 022B 自动回执 → #44 供应商客户建档 → #45 物料建档 → 017C1 批次一次确认 → 021C。P0 安全缺陷可提前插队，但也只有一棒。
- **Git 操作**：Cursor 只使用已有的 `git@github.com:youxihe/ai-erp.git` 远端进行 `fetch/pull/push`。不再试 `gh pr create`、HTTPS REST PR、浏览器 GitHub OAuth；**ChatGPT 使用已连接 GitHub 工具创建/Review/Merge PR**。SSH push 鉴权与 GitHub API PR 鉴权是两条不同通道。若仍弹登录框，捕获弹窗来源进程、Cursor 日志和发生时的具体命令，不能盲认是 SSH push。
- **发布**：当前可证实 GitHub master，不可从远端证实 F: Windows 是否为最新。单一发布人报告 git SHA + 宿主/容器 JAR SHA + F: plugin hashes + 真实企微消息类型 + 回滚点；查验后才标 LOCAL_DEPLOYED。020C 未完成可信查询数据边界之前，不将模拟数据图表当 ERP 报表演示。

## 2026-10-24 · 渠道富消息/表格图表/全写入审计 PDF 三大新要求（最高优先）

**部署真实进展**：GitHub master 在本轮检查为 `633e3de5`，上次可核验本机发布仅是 10/23 较早报告（#43 前的 JAR），当前无法从 GitHub 直接读取 Windows F:/Docker 运行状态，**不能宣称最新已上线**。发布负责人必须拉 master，运行新只读验证脚本 `powershell -File deploy/scripts/verify-demo-release.ps1`，检查 origin/master SHA、宿主/容器 JAR SHA、F: 插件与代码 hash、HTTP 健康；加上 Maven clean build / Bot channel 实际 SOP 探针与真人企微只读回包。提供当前 SHA/插件版本/回滚点，检查通过方可 `LOCAL_DEPLOYED`。

**官方企微 SDK 调研结果**：WecomTeam/wecom-openclaw-plugin、aibot-node-sdk 支持 Markdown、模板卡片（text_notice/news_notice/button_interaction 等）、图文混排、image、file；**当前 Bot WS 是否将特定消息真正渲染成卡片仍需本机版本/真实客户端确认**。图表、复杂表格不是任意 HTML/Card 的 CSS，应由通用渲染器画 PNG 并真实发送图片/Excel；WeCom 与未来 Feishu 使用不同 channel adapter。当前 `wecom-business.mjs` 大多 plain，并只取 firstLine，需改全量明细 DTO。

**新任务即刻 RELEASED**（开发与真人测试/ChatGPT Review 并行、仅单一 Deploy Owner 可更新运行态）：
1. **022A 审计 P0**：真实 ERP 写入全流程审计/不可变 PDF，当前 PURCHASE PDF 可用但 MIX/SERVICE 仅文本、主数据无 PDF；当前 `refreshPdfLayout` 覆写旧文件违反凭证一致性。先以真实原生 MIX/SERVICE 历史业务生成 PDF，无需重新扣增库存；后接 #44/#45/017C1 的写入。
2. **020B Visual #1**：企微原生 Markdown/TemplateCard/图文及多行采购卡片，突出商品/数量/单价/金额、已审核状态和入库增量；按 F: SDK 实测回执，不许在 before_dispatch plain 中输出 HTML/Markdown 源码。
3. **020C Visual #2**：图表/表格组件库（table、bar、line、pie、delta、KPI），OpenClaw 仅引用授权数据集选择固定 renderId，禁止模型编数据；图片消息真实企微验收，长表另发 XLSX。
4. **022B Audit Delivery**：任何由 AI ERP 发起并成功的采购/MIX/SERVICE/主数据修改/批次确认等操作，都自动生成对应 PDF 并真实发企微附件，失败只重发 PDF；文件不可变版本+sha、权限重验，不能误用采购 PDF。修复 `sop/wecom-outbound.mjs` 的 dirname(abs) 媒体白名单动态放宽。
5. 原队列 **017C1 批次一次确认、#44/#45 主数据建档**继续独立并行，但写入/回执需对接 022A 的通用审计接口，不能等全部合并才让用户测试只读/预览。

深度设计见 `docs/poc/RICH_CHANNEL_RENDERING_AND_AUDIT_ARCHITECTURE.md`；可直接执行的验收指南 `docs/poc/DEMO_UAT_RICH_MESSAGES_AND_RECEIPTS.md`；任务卡 `020B/020C/022A/022B`。**审计范围限于 AI ERP/OpenClaw 写入口**；未来如需覆盖 jshERP 后台全站所有操作，应扩展统一业务事件源，不能假称当前已覆盖。生成 PDF ≠ 发送成功 ≠ 用户已打开。

## 2026-10-23 · 快速并行 Demo 流程（覆盖旧串行规则）

用户已批准：Cursor **开发/自动化/本地单一 Demo 部署**与用户企微 UAT、ChatGPT PR Review/Merge **并行**；**不再强制所有代码先 Review+Merge 后才可进行 Demo 预览/草稿测试**。必须遵循 `docs/poc/FAST_DEMO_DELIVERY.md`：未完成权限、幂等、绑定版本、原始本人确认安全负例时，功能仅开放 PREVIEW/DRAFT，不允许实际过账/主数据提交；通过安全闸门后用户可本人确认真实测试业务。

截至当前 GitHub：#41 合并 `db13699f`、#42 `bccd9f52`、#43 `baefd2a4`、#47 热换 JAR `0c841fbd`。最新 master 已有 PURCHASE/MIX/SERVICE 三线；**GitHub 合并不代表本机 F: 已部署最新 #43**，需要唯一 Deploy Owner 提供 bootJarSha、F: 插件源版本及健康证明，部署后用户先测试 **2采购单/3行、配制FG-101/3原料、服务FG-101/1L 的无过账准备**。

并行开发 #44 Partner、#45 Material 两种建档（需真实 DB/角色/并发检查），新释放 **017C1 批次本人一次确认/部分成功/XLSX回执**，渠道 SOP/格式 020A 非阻断。后续补齐 021C 缺档续办。队列历史段落的 REVIEW_FIX_REQUIRED 均为历史快照，不能覆盖本节和上述最新表格。

## 2026-10-22 23:10 · 首轮五支远端 READY 全部正式 Review，五个 P0/P1 Fix 排队

远端已存在并开 PR：**#41 017B2 (525d4286)、#42 016M (d2266e7c)、#43 016S (9d816546)、#44 021A (cf509055)、#45 021B (66ea17ba)**。Cursor 本地第一波 agent 中途退出不影响：第二波已 Push，GitHub HEAD 经 ChatGPT 查验。已经对**五条 PR 全部分别提交具体 REVIEW_FIX_REQUIRED 评论**，故 NONE is approved for immediate Merge/F: deployment. 证据笔记里的 SHA 可能过期，Review 均以实际 PR HEAD 为准。

- **#41 NEXT**：已有 DDL `aierp_excel_batch`（deploy/sql/04-aierp-excel.sql）无须迁移；但网关 CONFIRMED 且无原生审核单号或对应 depot_head 的情况被错误标成“已审核入库”，须按 RECONCILIATION_REQUIRED 拦截错误宣称；同文件重放批次 revision 不应自增。Review Fix 后优先合并。
- **#42 MIX**：对话配方仅由模型参数 `recipeUserConfirmed=true` 伪称“用户已确认”不成立；需真正展示/认可配方 hash，且不得推导化学配比；与 #41 的 ExcelService/Gateway 与 #43 的确认/插件路由整合，验证采购/配制/耗料确认严格隔离。
- **#43 SERVICE**：受控本地 1L 出库已有证据，但真人企微仍 NOT_VERIFIED；需与 #41/#42 的共享 Controller、Gateway、ExcelService、Plugin、Receipt 合并，用户/客户/仓库授权和已审核重复上传要明确。
- **#44 PARTNER**：`commitInTx` 按 `consume_message_id` 全局查询后在归属校验前直接返回重放结果，跨身份信息泄露；必须先校验 sender/tenant/actor/binding 或移动到权限判定后。与 #45 同名 `AierpWecomMasterDataService` 文件必须拆分。
- **#45 MATERIAL**：仅有绑定用户身份，没有校验物料创建/修改角色权限；`eventSource=null` 被 commit 接受；都必须 fail closed。与 #44 同类同路径 + `确认建档数字号`（双独立递增表）的**确认指令冲突**，须拆分服务并按实体类型明确路由。
- **合并次序**：#41→#42→#43→#44→#45，每个分支按真实 master rebase/merge 并跑真实组合测试；#44/#45 可以并行提交修复，但后一条必须建立独立 Service/专用确认名称以避免覆盖前条。无需重跑此前已审核 GW-PURCHASE-119/本地 GW-SERVICE-136，开发测试默认非过账。
- **F: 单运行态**：任何未 Review/合并的分支都不能直接覆盖运行中的 015B/017B1/015C Plugin。等合并+组合验收后由唯一部署责任方同步，以真实企微原文操作进行必要的**用户本人** UAT；安全边界不允许自动过账。

## 2026-10-22 · 主数据也纳入 OpenClaw 核心业务链

**用户新增要求**：新原料、供应商、客户也应该直接通过企微对话完成新增、修改，业务过程中遇到缺档不能要求用户跳去 ERP 后台。当前 `MaterialController /material/add,/update` 与 `SupplierController /supplier/add,/update` 已有原生能力，但原 Service 中使用 `userService.getCurrentUser()` 与会话日志；物料新增/修改还可携带 `stock` **修改期初与当前库存**，不能直接暴露给 Agent。

新增两条独立可开发任务：
- **021A RELEASED #4**：供应商/客户建档与普通联系方式修改 SOP，显示字段摘要/差异，经用户原始企微确认才写 ERP；银行/税号/财务余额、停用/删除等不允许普通聊天更改。
- **021B RELEASED #5**：原料/物料新增和名称规格备注受控修改，ERP `Material+MaterialExtend` 双表写入、bar_code 与单位一致、全仓库存不变，不允许经此入口设置库存/修改已有基础单位。
- **021C PLANNED**：业务缺档后将已验证的采购/配制/客户耗料上下文服务端保存，建档后自动继续未审核草稿准备，**绝不能把确认建档误作业务过账授权**。

所有 SOP 均走可信企业微信原文确认 + 后端显式 ERP actor、当前功能/租户权限、版本/业务 digest 与幂等；不能伪造 HTTP Session/RequestContextHolder，也不能把 ERP 写 API 提供给模型任意执行。任务及实测脚本 `docs/poc/queue/AIERP-021A.md`、`021B.md`、`021C.md`、`docs/poc/DEMO_UAT_MASTERDATA_CHAT.md`。

## 2026-10-22 16:55 · 三类功能扩展及演示 UAT：多单采购、配制生产、服务耗料

用户确认“标准业务 SOP 脚本 + OpenClaw MD 触发/意图 + 真实 ERP 原生单据及回执”路线，优先丰富实用功能。**PR #37 015C 已由 ChatGPT Review 并合并 `69da0fe5`**；真人企微截图出现真正 PDF 文件卡片而非 MEDIA 路径，PDF 客户端打开/最新“确认后自动发送”和新库存表仍待新 UAT，绝不可将它们描述为全部实测通过。格式美化需按企微、飞书渠道独立渲染；不要把 HTML 标记转成纯文本或硬编码通用颜色。

**新开发队列（可以独立并行写代码，但 F: 单一运行插件只允许集成后统一部署）：**
1. **017B2 RELEASED**：多单采购 XLSX→分组校验→持久化批次→真实多 DRAFT；先修已审核 #119 原 XLSX 重传错误显示“未入库 / 待确认”的回放状态。**不直接批量审核**。
2. **016M RELEASED**：配制/组装（MIX）多原料→成品，优先复用已有 Excel 和 ERP MIX 原生 draft/confirm，正式审核只接受用户可信原始私聊 `确认配制{数字ID}`，明确不是 MES 自动配方。
3. **016S RELEASED**：客户服务耗料（SERVICE），ERP 中真实客户、成品仓出库，可信原始私聊 `确认耗料{数字ID}`，**不得混成销售出库**。
4. **017C1 PLANNED**：在 017B2 Review/Merge 后释放批次本人一次确认、逐单幂等过账、部分成功与 XLSX 回执；不可绕过原生事务或把旧 excel.confirm 开给模型。
5. **020A 继续 RELEASED**：独立渠道 renderer（WeCom plain/Markdown/card、Feishu 单独 schema）、业务 SOP registry，按业务进展集成，不抢占 F: 运行态；019B 通用动态 Gateway 仍后置。

**测试执行指南已写入** `docs/poc/DEMO_UAT_MULTI_PURCHASE_MIX_SERVICE.md`：采购 2 单/3 行（RM-A001 合计 +3 L、RM-B002 +0.5 L，需当前实际供应商/单价核实）；配制 FG-101 1 L 的**用户确认测试配比**，原料仓扣料/成品仓加料；服务耗用 FG-101 1 L，成品仓扣减，客户必须来自真实 ERP 主数据。先记录**当前**库存数（不能复用 170.7 等历史值），只在用户本人明确确认时改变库存。负例、重复上传、跨用户、权限撤销与错误行需要明确拒绝。不能自行 Merge 或在未授权情况下自动过账。

## 2026-10-22 14:25 · PDF 真机发送失败与 SOP/业务排版整改（本轮最新）

用户企微截图已证实：机器人确认 GW-PURCHASE-119 已审核、读出 PDF 后，**把本机 `MEDIA: F:\\aierp-openclaw\\...` 路径作为普通文本输出**，并未附带文件；用户随后回复“文件直接发我”，模型竟发了采购 XLSX 模板。这次 **PDF_OUTBOUND=FAILED**，不能仅称“PENDING_USER”。Java HMAC `receipt/file`、PDF SHA256、库存不变与 8/8 意图单测仍有效，但**不能等价于企微附件真正送达**。

已建立 **PR #37 AIERP-015C REVIEW_FIX_REQUIRED**。源代码 `before_dispatch` 返回 `{handled:true,text:"...\\nMEDIA: <WindowsPath>"}` 是错误投递路径：OpenClaw 普通插件/Hook 文本不保证把媒体指令变成文件。按当前 **`@wecom/wecom-openclaw-plugin`** 的版本使用结构化附件 payload 或可信 SDK 发送接口/支持的 channel sender，至少在 PC 端真实收到并打开 `采购入库业务回执_GW-PURCHASE-119.pdf`，且在一句“文件直接发我/重发”时延续**服务端绑定的回执待发送状态**、绝不回退 Excel 模板；不触碰已审核库存、不重复过账。

用户还要求提高**业务文字的视觉层级**、明确加粗/颜色等实际支持方式，以及“标准 SOP 写为脚本、OpenClaw MD 只描述何时调用脚本”，避免模型逐个动态推理底层业务 API。新增 `AIERP-020A`（RELEASED SOP/UX，独立小棒）与：
- `docs/poc/AGENT_SOP_EXECUTION.md`
- `docs/poc/WE_COM_BUSINESS_MESSAGE_STYLE.md`
- `deploy/openclaw/workspace/skills/erp-receipt/SKILL.md`
- `docs/poc/queue/AIERP-020A.md`

实施优先级：**015C 可实际发 PDF 第一**，020A 同轮可将 receipt-send 脚本化及格式渲染集成，但**不得为了大规模 SOP 重构而阻塞真实 PDF**。其余库存/采购/生产/服务 SOP 逐个迁移。企业微信插件官方支持 Markdown/模板卡片，但字号/颜色受渠道限制，必须以本机已安装版本/客户端验收，不可模拟 HTML CSS 或在文本内硬加颜色标签。

## 2026-10-22 13:35 · 017B1 已验收，PDF 回执交付成为下一 P0

**真人企微验收已完成**：Excel 实际单据 `CG-20261021-230716-ACC9`、RM-A001 80 L、华东化工、原料仓、单价 20 元 → ERP 真实草稿 #119 → 本人回复 `确认采购119` → 原生已审核单据 `GW-PURCHASE-119`，库存 **170.7→250.7 L**（+80 L），文字回执成功。PR #35 已 ChatGPT Review 并合并 `e3ef4c86`。GitHub Review 附加三项 Java 安全强化：server 自算上传文件 SHA；prepare-verified 匹配当前授权预览 ID + file hash；改文件时旧草稿取消失败立即停止新建。Cursor 下一次部署前跑非过账测试/Java build，**不要重跑已成功的 80 L 入库**。

**本次 Demo P0 体验缺陷**：确认后用户说“《采购入库业务回执》发我”，Agent **错误调用采购模板**，回复“未入库”并发出 XLSX。这与真实已审核单据事实冲突。后端已经有 `aierp_gateway_receipt` 记录和服务端生成的 PDF，另有 ERP 登录 `POST /aierp/v1/wecom/receipt/pdf` 仅供 Session；但**没有可信企微 Bot 只读回执文件领取和稳定发送通道**。

**新任务 AIERP-015C 正式 RELEASED**：从已合并的 master 独立 `feat/aierp-015c-wecom-real-receipt-pdf`，优先匹配明确回执请求 → 检索最后一笔本账号确认的**已审核**采购 `GW-PURCHASE-119`/用户指定原生单号 → ERP 授权 PDF bytes → 企微正确 PDF 文件附件（不能发 Excel 模板），服务端审计发送状态。附件成功可打开才算 `PDF_SENT_VERIFIED`；失败不能改已完成的库存、不能说未入库或发送成功。禁止模型任意磁盘/HTTP 读文件，不使用管理员 session；从最近的绑定 user + bot + wecom sender + binding version 实时鉴权。详见 `docs/poc/queue/AIERP-015C.md`。

**后续排序**：015C 成功 → 017B 多业务采购/配制/服务耗料批次 → 017C 批次确认和 XLSX/PDF 回执。019B 通用动态 ERP Gateway 和 016 拓展按用户 Demo 需要安排；先不要争抢单一 F: 运行态插件。

## 2026-10-22 07:12 · 017A 已 DONE，017B1 立即开工

- **PR #30 已重新开放、最终 Review 并合并**：`25d4c98f`。真实企微成功解析 XLSX；模板标记必填/选填、预填唯一业务单号与日期；`excelWorkflowCancel=true` 模型参数绕过已删除；Redis 保存最新预览摘要，禁止从文件名猜数量建草稿。ChatGPT 另补换绑后旧预览不可读的 actor/tenant/bindingVersion 校验，此补丁尚需 Cursor 本机无过账回归。
- **客户 2026-10-22 07:09–07:10 真实 Demo**：成功预览一张业务单 `CG-20261021-230716-ACC9`、RM-A001 **80 L**、华东化工、原料仓、20 元/L、合计 **1600 元**；用户随后“按照这个进行实际入库”“确认”“确认采购CG-…”均未过账，机器人又误拿此前口头 20 L / 400 元建单方案。**Excel 业务单号 CG-... 与真实 ERP draftId（数字）不同**，不能混用；主导业务数据必须取 XLSX 真实预览中的 **80 L**，不能回退旧会话的 20 L。
- **017B1 正式 RELEASED**，从最新 master 独立 `feat/aierp-017b1-verified-xlsx-purchase-confirm`。这次只做一张采购单（可多行）：真实 XLSX → 后端唯一、合法的最新预览 → 服务端自动生成真实未审核 DRAFT → 企微展示 **80 L / 1600 元 + 数字草稿号** → 客户仅回复一次 `确认采购{draftId}` → 复用已经验证的 015B 本人原始消息/原生事务入库 → 返回已审核单号、库存变化与回执。**用户无需先“取消文件”、重新传 Excel、再口头复述信息。**
- **P0 保护**：文件解析结果只从存储的 `aierp_excel_preview.payload_json` 获取，不由模型用文件名/历史口头需求猜；可信 sender/bot/ERP actor/tenant/binding_generation/fileSHA/版本与当前角色/仓库复检；同文件/消息重试不重复建草稿；重传修订失效旧挑战；业务单号不是数字 draftId；历史错误来源草稿 #113 绝不自动确认。正式过账继续必须真实企微用户授权，且不开放 `excel.confirm` 模型工具。
- **本地运行态 F: 单实例**：本机当前是否已同步 GitHub 017A 最新补丁，需要 Cursor 验证并跑无过账测试；ChatGPT 仅完成 GitHub 审查与合并，不宣称本机脚本已再次运行。
- **次序**：017B1 客户 Demo 一单闭环 → 017B 采购多单 / MIX 生产 / SERVICE 耗料 / SALE 出库 → 017C 可信批次确认与业务回执；019B 动态工具 runtime 仍后置。禁止把该阶段拆成新的长方案研究。

## 2026-10-21 20:48 · 实测 Excel 已成功解析；核心阻断转为“预览 → 草稿 → 确认”

**用户真人企微最新证据**：三次发 Excel，其中两次返回真实 `PREVIEWED` + `previewId`，最后有效单号 `T-20261021`，RM-A001 100 L，华东化工，原料仓，单价 20 元，无错误；库存不变。**不要再将 017A 描述为文件上传解析不通，也不要要求用户继续重传作同一目的的测试。**

当前模型却在用户回复“按文件处理并确认入库”“入库吧”时声称没有收到文件，说明服务端记录的最新有效 preview 与 Agent 后续消息没有连接。017A 当前只允许预览，不应该虚称已能批量/Excel 过账；新释放 **017B1 单张采购快线** 负责“由已验证 preview 后端读取原始规范数据 → 生成真实未审核 DRAFT → 仅由本人可信入站确认审核入库”。

另一个 **P0 安全缺陷**：`AierpWecomDraftService.purchasePrepare` 根据**模型传入** `excelWorkflowCancel:true` 绕过 Redis 文件工作流门禁；必须从 PR #30 移除该 bypass，独立认证“取消文件”接口才允许关闭工作流。模板中首次出现“缺少业务单号”，需明显标记字段 **必填/选填**、说明同业务单号多行、提供自动唯一单号和日期预填、样式清晰；已完成预览以后不要显示英文 `previewId`、`canConfirm`、`scene`、`行null`、重复技术解释。

**加速次序**：#30 原分支最小修复（真实文件预览已 PASS，不再重复造失败）→ ChatGPT Review/Merge → 017B1 从最新 master 独立做一个采购 Excel 单张业务闭环 → 017B 生产/耗料/销售批量扩展 → 017C 多单可信确认。019B 动态 Agent 网关继续后置，不能阻塞客户 Demo。

详见 `docs/poc/queue/AIERP-017B1.md`，F: 唯一 OpenClaw 实例需先集成回归、再部署，绝不能任由并发分支覆盖插件。#113 不许自动确认。

## 2026-10-21 18:58 · 真人 Excel UAT 失败（立即修复 017A，阻断 017B/017C）

- **AIERP-015B / PR #27 已 DONE**：ChatGPT Review 并合并 `c94e192c`。用户真人企微 `确认采购111` → 原生 `GW-PURCHASE-111`，库存 160.7→170.7 L；authz fix 18/18，不能重跑历史草稿。
- **AIERP-019A / PR #31 已 DONE**：能力目录和业务 SOP 设计完成（`6a447f13`），并不代表运行时已安装动态 API Tool。
- **AIERP-017A / PR #30 REVIEW_FIX_REQUIRED**：用户企微返回改名 `采购入库模板---100L---….xlsx`，**没有真实 Excel PREVIEWED**；模型却依据文件名“100L”创建未审核采购草稿 **#113**。禁止过账 #113，除非未来经过真实数据核对、用户明确重新发起独立业务；默认提醒用户取消该错误来源草稿。
- **高优先级技术原因**：当前 Excel 入站插件用 `message_received`（OpenClaw 官方规范 OBSERVE，不能保证修改 event.content 生效）、`inbound_claim`（仅被所属 core conversation binding 插件调用）；真实附件未获本插件可靠解析。务必查 F: 当前实际安装的 WeCom 插件、完整 file/media 事件和 staging 状态；使用可信入站、可见文件字节的 pre-LLM handler / Channel 自有文件 adapter，**不允许 filename 猜测数据**。无解析时返回清晰 `FILE_PARSE_FAILED`，并在服务端阻止与该文件相关的任何新草稿生成。
- 017A 只做模板发送 + 真实文件解析预览，不得绕过 017B/017C 直接批量过账。**只有企微真实附件字节 → ERP 实际 previewId / 单元格数据 → 用户预览成功且库存不变才可 MERGE PR #30**。用户文件名带“---100L---”不得影响 Excel 内容解析。
- **Cursor**：原分支 `feat/aierp-017a-wecom-xlsx-inbound-preview` 按 PR #30 最新 ChatGPT Review #3 修复，更新 master 后保留 015B before_dispatch 采购确认及 13 Tools；不自行 Merge、不重装 F:、不触发 #113 的原生审核。017B/C、019B 仍 PLANNED。

## 2026-10-21 · Excel 批量业务提升为客户 Demo P0（含出库与生产）

**新的优先级**：015B PR #27 授权修复 → **017A Excel 企微文件收发/预览** → 017B 多场景批量 DRAFT → 017C 本人可信确认/原生多单过账/回执。019A API/SOP 设计可并行，**不让抽象架构开发阻塞用户可见的 Excel 演示**；019B 通用工具 runtime 实施待 Excel 第一条实际文件链路验收后再排。

- `AIERP-002` 已实现真实 XLSX：`PURCHASE`、`MIX`、`SERVICE` 的模板、解析、预览和 PC 手动确认；`SALE`、`INITIAL` **仅模板不能确认**。已有 `/aierp/v1/excel/confirm` 会立刻逐单过账，绝不能作为模型可调用批量工具。
- 017A **现正式 RELEASED**：真实企微请求模板→发送 XLSX→用户填写返回文件→可信附件处理→ERP 真实文件预览/校验、库存与原生单据零变化。当前 OpenClaw Windows native `F:\\aierp-openclaw`，不重装/升级。
- 017B **未 RELEASED**：按用户上传文件创建未审核批量草稿，优先采购、`MIX` 药水配制/组装、`SERVICE` 客户服务耗料。销售出库 `SALE` 需要额外的 jshERP 原生正式出库方案与权限、金额、审计验收，不能假装 `SERVICE` 就是完整销售；普通领料/其它出库 P1；调拨/退货/盘点/期初 P2。
- 017C **未 RELEASED**：一次可信企微原文确认绑定**批次版本 + 实际有效单据清单 hash**，服务器以原生单据逐张幂等入账，成功/失败明细可追溯；返回批次回执 XLSX，PDF 可附加。若存在部分成功必须准确标记，不能谎称原子全部成功。
- `015C` 企微 PDF 送达的受控文件发送能力与 017A 的 XLSX 文件发送可复用同一个专用媒体适配器，禁止授予 Agent 任意磁盘文件上传 Tool 或启用所有 WeCom CLI 工具。

演示脚本及验收：`docs/poc/EXCEL_BATCH_DEMO_ACCEPTANCE.md`；任务卡：`docs/poc/queue/AIERP-017A.md`、`AIERP-017B.md`、`AIERP-017C.md`。Cursor PR 分支每一棒 Push + ChatGPT Review 后再 Release 下一棒，**不能自行 Merge**。

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
