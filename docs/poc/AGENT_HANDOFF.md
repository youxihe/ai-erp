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

### 并行 #4 · AIERP-021A 客户/供应商主数据

- 独立分支 `feat/aierp-021a-partner-masterdata-sop`，任务卡 `docs/poc/queue/AIERP-021A.md`。供应商与客户都使用 jshERP 原生 `Supplier` 实体，必须区分 `type=供应商|客户`。新增和普通联系人/电话/地址修改须先 prepare 差异，再本人原始消息 `确认建档{申请号}` / `确认修改{申请号}` 独立确认，才可持久化并给出 ERP 实际 ID。敏感银行/税务/往来余额禁止。原生服务靠伪 Session 不可接受。
- 查重、权限、跨租户、同秒换绑、重复请求、取消、客户授权关系必须测试。真实客户/供应商立即能用于 016S 服务/017B2 采购查询。代码可独立开发，但不得与其它分支同时覆盖 F:。

### 并行 #5 · AIERP-021B 物料/原料主数据

- 独立分支 `feat/aierp-021b-material-masterdata-sop`，任务卡 `docs/poc/queue/AIERP-021B.md`。关键：物料存在 `Material` 主档与 `MaterialExtend` 条码 SKU 单位；原生 MaterialService 的 `stock` 参数会改期初/当前库存；聊天建档必须**硬拒绝任何库存字段**并在事务/落库检查中确认**全部仓库库存零变化**。
- 仅开放名称/编码/当前ERP已有分类/单位/规格/备注/品牌等受控普通字段，准确展示修改差异，本人确认后才调用后端显式身份 safe facade；失败不可谎称成功。完整用已有代码，不另造全新物料体系。
- 021C 业务中缺档的连续操作已规划，先不让未验收 master-data 写入阻断 017B2/016M/016S 开发。

### 次序与收口
- `AIERP-017C1` 批量可信确认待 017B2 Review 后放行。
- `AIERP-020A` SOP/渠道排版可以并行产出独立 JS renderer，按企微/飞书各自支持的 Markdown/卡片 schema 输出，不要在纯文本里生造 `<font>`。
- `AIERP-019B` 动态 API 网关继续后置；此轮重点三个可演示业务完成。
- 本地 F: 运行态真实客户端验证脚本见 `docs/poc/DEMO_UAT_MULTI_PURCHASE_MIX_SERVICE.md`，库存变化不可预设真实基准数，务必取现场最新快照。

严格：不暴露模型确认工具、不重装 OpenClaw、不泄露真实客户文件/口令、不确认已审核 #119 或误来源 #113、不自行 Merge。
