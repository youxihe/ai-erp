# AI-ERP Cursor Agent · 2026-10-24 最新交付指令（优先于旧 handoff）

用户新目标：**企微真消息卡片深度美化、通用图表/表格展示脚本、所有 OpenClaw 发起的真实 ERP 写操作必须留档并自动 PDF 回执**。仍执行本地 Demo/UAT/ChatGPT Review 并行模式，唯一仓库 youxihe/ai-erp，单一 Deploy Owner 操作 F:/app.jar。完整方案见 docs/poc/RICH_CHANNEL_RENDERING_AND_AUDIT_ARCHITECTURE.md 与验收 docs/poc/DEMO_UAT_RICH_MESSAGES_AND_RECEIPTS.md。

## Step 0: 立即确认运行态真的最新

本轮 GitHub 检查 master=633e3de5。**ChatGPT 无权限访问你的 F: Windows 实机**，故不允许口头报告“已发布最新 master”却没有证据。部署负责人拉 origin/master / clean Java build，运行 powershell -File deploy/scripts/hot-reload-boot.ps1，然后运行 powershell -File deploy/scripts/verify-demo-release.ps1；备份并同步 F: 插件，一次性检查 HEAD、构建证明、host/container JAR SHA、插件 index+SOP 文件 SHA、ERP 9999 doc 200/Gateway 18789 health 200、**channel 真的加载能力**及企微查询原料库存成功。脚本只读，不自动完成部署。记录脱敏输出、上一版备份、启用功能/受保护的真实确认路由。不能并发覆盖 F:。

## 四条可同时开工的开发任务（从最新 master，各自 Push PR）

1. **022A Audit P0**：docs/poc/queue/AIERP-022A.md。统一成功/拒绝/失败业务审计 event、真实原生单号和 before/after；MIX 与 SERVICE 专用 PDF、采购已存在 PDF 的不可变 layout 版本；以后接主数据/批次。不得因生成 PDF 失败再重新过账；旧 #119/#136 只读取证。
2. **020B Visual #1**：docs/poc/queue/AIERP-020B.md。深读官方 SDK + F: 实际安装版本，实测企微原生模板卡片/Markdown、图片、混排、文件；从 first-line-only 改多商品名称/数量/单价/行金额/合计，PC/移动端截图真实证明，不能输出 HTML tag/MEDIA 路径。
3. **020C Visual #2**：docs/poc/queue/AIERP-020C.md。通用 table PNG、bar、line、pie、stock delta、KPI：只接受真实 ERP 授权 datasetRef+allowlisted renderId/Schema；企微真实图片消息，大表 XLSX，可复用到今后各种 ERP 查询而不用每个报表写专用统计脚本。
4. **022B PDF Delivery**：docs/poc/queue/AIERP-022B.md。所有真实写操作成功后自动将对应 PDF 通过 Bot WS 送到本人会话并留投递状态；同凭证重发不重过账；修 wecom-outbound dirname(abs) 动态白名单；对接 022A 的审计 DTO/不可变文件。

**已有 #44 Partner、#45 Material、017C1 批次确认继续并行编码**；不要因为新视觉任务停止用户最关心的主数据和批次流程。所有代码可以提交独立 PR 并本地先发布只读/草稿预览，ChatGPT 并行 Review，业务真实写入仍需角色/身份/绑定/原始本人确认/幂等关键测试通过。

## 输出与同步
只报真实进展：PR/branch/head、clean BUILD + 功能 tests、GitHub merge vs local deployed vs human WeCom UAT 三态、当次发布 JAR sha/F plugin hash、PDF hash 与实际消息类型（text/card/image/file）及客户端能否打开。Cursor 可自己持续投任务/Push，不自行 merge；ChatGPT 负责 Review/Merge。真正自动发送 PDF 不得虚称“客户端已打开”，无法发送只报告已审核/未送达。

## 期待第一轮最快验收
- PC 企微收到真实卡片/图片，其中**2张采购单3行明细**商品名称、数量、单价、行金额及汇总一目了然。
- 同一真实 ERP 查询切换 table/bar/line/pie；若数据不适于某种图表，业务说明为什么降级。
- 已审核 MIX/SERVICE 原生单据各对应准确 PDF，不能把采购回执改标题冒充。
- 成功写入后不必再主动索要 PDF；失败可重发，审计可按业务单号/操作者/时间查询。

---

# AI-ERP Cursor · 2026-10-23 本地 Demo 并行快线（本段优先于旧 handoff）

用户明确同意：**持续开发 → 本地自动化 → 提前 Demo 部署 ↔ 用户实时企微验收 ↔ ChatGPT 并行 Review/Merge**。完整安全/部署/验收约束见 `docs/poc/FAST_DEMO_DELIVERY.md`。不再等所有功能审完再让用户看页面/发送 Excel。

## GitHub 当前
- 017B2 #41 **DONE** `db13699f`；016M #42 **DONE** `bccd9f52`；016S #43 **DONE** `baefd2a4`；Ops #47 **DONE** `0c841fbd`。
- #44 (Partner) / #45 (Material) **INTEGRATION**：先同步最新 master，修角色、并发唯一性、可信消息隔离，运行真实 DB 回归；允许在未完整 Review 时提前部署业务**字段预览/申请准备**，写入确认入口待最小安全负例通过。
- **017C1 RELEASED NOW**：从最新 master 并行开 `feat/aierp-017c1-purchase-batch-confirm`。批次 manifestHash + revision、本人真实企微 `确认批次{batchId}`、逐单原生幂等审核、PARTIAL_SUCCESS 与 XLSX 回执。可以提前部署**批次清单/草稿展示**，可信批次提交未经过角色/绑定/幂等测试前必须禁用。不要模型直接调用旧 excel.confirm。
- 020A WeCom/Feishu 各自消息渲染及 SOP script 可并行，不因字体/卡片阻塞业务演示。

## 立刻执行两条流水线
**Deploy Owner（单 Agent、单运行态）**：从当前最新 `origin/master` clean-build / hot-reload（#47），备份并同步 F: OpenClaw 插件；核对 jar host=container SHA、Boot/Gateway health、当前渠道工具/SOP；先跑 017B2 18/18、MIX 22/22+28/28、SERVICE 不入账回归。报告用户可立即测试的**自然语言**和 3 场景，**不强迫用户等 #44/#45**。记录原料/成品当前库存，不复用昨天值。部署动作只有唯一负责人，别让 5 条分支同时写 `deploy/runtime/app.jar` 或 F:。
**Dev Agents（并行）**：#44/#45 从自己的 worktree 合并最新 master 并尽快 Push 新 HEAD + 实际 DB 回归；017C1 独立开工 Push 早期可运行子 PR；在已部署安全版本上处理用户当场反馈，修完即可重新部署预览，不要求 ChatGPT 在每一轮先 Review。
**ChatGPT（本对话）**：同时审实质差异，快速合并低风险/安全闸门通过的功能；若发现跨租户/代际权限或重复过账风险，暂停**对应写入口**但不阻塞其它场景的预览、SOP 研发或本地用户体验测试。

## 进度交接固定格式
`PR/HEAD, Java BUILD, non-post regressions, live UAT, deployed Boot JAR SHA, F-plugin SHA, enabled business routes, gated write capabilities, rollback artifact`。区分 GitHub MERGED、LOCAL_DEPLOYED、LIVE_UAT_PASS；不得混同。

**请立即认领工作，不需等我下一次“继续”才开工。** 对 #44/#45 与 017C1 可并行 Push，但不自行对用户真实历史单据确认或重复入库。人可以明确批准新的测试草稿和本人确认。
