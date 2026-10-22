# AI-ERP Cursor Agent · 客户 Demo 三业务扩展（2026-10-22）

**唯一仓库** `youxihe/ai-erp`；不可动 ZTO HR。PR #37 015C **已合并 69da0fe5**；用户企微已出现采购回执 PDF 文件消息。最新自动发送/PDF 新样式的用户打开验收仍待进行，禁止在新业务中重写 PDF 发送层。

**当前 RELEASED 多流水线**（Cursor 根据任务卡执行，PR 每棒 GitHub Review → ChatGPT Merge；同一个 F: Windows native OpenClaw 只允许从已集成的 master 执行部署）：

### 首选 #1 · AIERP-017B2 多单采购
- 分支 `feat/aierp-017b2-multi-purchase-draft`，从最新 master 创建。完整看 `docs/poc/queue/AIERP-017B2.md` 和 `docs/poc/DEMO_UAT_MULTI_PURCHASE_MIX_SERVICE.md`。
- P0 先修旧 Excel #119 已审核，却再次显示“待确认/未入库”的重放状态，查询**真实原生审核/回执**确认，不做二次入库。
- 同文件有 2 个业务单号、3 明细行，合并生成 2 个未审核数字草稿、同文件/并发幂等；未过账库存零变化。有错误行不得静默过账；同业务单号供应商冲突时报错。
- 017C1 一次“确认批次”另行 Release，017B2 不直接给模型 excel.confirm。
- PR Push READY_FOR_REVIEW、无过账脚本和脱敏证据，Cursor 不自行 Merge。

### 并行 #2 · AIERP-016M 配制生产
- 分支 `feat/aierp-016m-mix-sop`，独立基于最新 master、尽量新增独立 SOP/Java 服务模块而非同改 plugin/index.js；详情任务卡 `AIERP-016M.md`。
- 单张 MIX Excel 同配制单号多原料成一张草稿；用户明确测试配方，成品 FG-101 产出、RM-A001/B002/C003 扣原料仓，生产不等于完整 MES。
- 走**可信原始消息**的 `确认配制{数字草稿ID}`，ERP 真正审核/库存变更，中文回执；原料不足/仓库权限/单位错误/重复确认均拒绝或幂等。
- 可独立完成源码/本地测试，但在 017B2 运行态集成后统一上线 F:；不可并发覆盖已经运行的 13 工具。

### 并行 #3 · AIERP-016S 客户服务耗料
- 分支 `feat/aierp-016s-service-outbound-sop`，独立基于最新 master；详见 `AIERP-016S.md`。
- 真实 ERP 客户 + FG-101 成品仓 1 L；Excel/对话 → 未审核草稿 → 用户可信原文 `确认耗料{数字draftId}` → 原生 SERVICE 审核出库，库存只扣对应成品仓，不生成销售单/应收。
- 非过账自动化与实际本人 UAT 分开；不要让 Cursor 自动确认用户真实单据。

### 次序与收口
- `AIERP-017C1` 批量可信确认待 017B2 Review 后放行。
- `AIERP-020A` SOP/渠道排版可以并行产出独立 JS renderer，按企微/飞书各自支持的 Markdown/卡片 schema 输出，不要在纯文本里生造 `<font>`。
- `AIERP-019B` 动态 API 网关继续后置；此轮重点三个可演示业务完成。
- 本地 F: 运行态真实客户端验证脚本见 `docs/poc/DEMO_UAT_MULTI_PURCHASE_MIX_SERVICE.md`，库存变化不可预设真实基准数，务必取现场最新快照。

严格：不暴露模型确认工具、不重装 OpenClaw、不泄露真实客户文件/口令、不确认已审核 #119 或误来源 #113、不自行 Merge。
