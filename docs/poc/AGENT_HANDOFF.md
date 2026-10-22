# AI-ERP Cursor · 2026-10-22 23:10 首轮五 PR Review Fix 接力

**Repo only:** youxihe/ai-erp。五条分支已经在 GitHub 建 PR，Cursor 不自行 Merge、不覆盖 F:。ChatGPT 已对每个 PR 提交正式 Review Fix 评论，务必逐条阅读：
- PR #41 / AIERP-017B2 HEAD 525d4286：优先修 Confirmed 无真实原生单据误报已入库、同文件 batch revision 重试递增；13/13 本地非过账通过仅作为基础。Push REVIEW_FIX_PUSHED 让 ChatGPT 先审并合并。
- PR #42 / AIERP-016M HEAD d2266e7c：model 传 recipeUserConfirmed=true **不等于用户核对配方**；必须对原料/产出数量显示明确确认 hash，禁止 AI 自行配方。MIX 与 PURCHASE/SERVICE 原始消息确认必须严格区分。PR #41 合并后 rebase 最新 master 并保留批次代码。
- PR #43 / AIERP-016S HEAD 9d816546：服务耗料客户权限/仓库权限、重复已审核数据状态、跨类型确认、官方 receipt media 不回归；PR #42 后集成代码并复测，不复用已审核 GW-SERVICE-136 的过账。
- PR #44 / AIERP-021A HEAD cf509055：修复 consume_message_id 全局重放早返回导致跨 sender/tenant 漏出 partnerId；重放必须先按本人/当前绑定验证；与 021B 的 MasterDataService 同类同路径及相同“确认建档数字号”歧义都要消除。重命名为 PartnerMasterDataService 或其他唯一类，专用命名空间确认协议。
- PR #45 / AIERP-021B HEAD 66ea17ba：物料 prepare+commit 均需真实 ERP 角色功能权限，拒空 eventSource，专用 MaterialMasterDataService/独立确认命名空间、条码唯一并发与零库存测试；不可用无权限库存查询账号建档。

**Priority order:** 017B2 → 016M → 016S → 021A → 021B。各分支可并行改 Review Fix，但 merge 后后续分支须重新集成最新 master，合并共享 Java Controller/GatewayService/ExcelService、registry、plugin/index.js 与 SOP。绝不能覆盖 master 当前已跑通的可信采购确认、PDF 企微附件、采购 Excel 与回执样式。

**交付格式:** REVIEW_FIX_PUSHED + exact branch HEAD + changed files + automated nonposting pass/fail + any required real tests NOT_VERIFIED. Cursor 不自行 Merge；GitHub 合并由 ChatGPT 逐一审阅与执行。

**客户 Demo 后续:** 采购 2 单/3 行、FG-101 测试配方组装、真实客户 FG-101 耗料、测试供应商/客户与新 RM 编码物料建档。原生库存真实变更必须由企微用户本人先核对业务摘要并在可信原文中明确确认后进行。
