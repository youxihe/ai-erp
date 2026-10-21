# AIERP-019A · Agent SOP 对话验收矩阵（docs-only）

用于 Review 019A 目录与 Skills 是否覆盖真实业务话术。**不代替**自动化 E2E；019B 实现后逐条跑 Tool。

**三个重点场景**：① 沿用之前供应商采购 ② 原料仓库存 ③ 配制/耗料只读 + Excel 批量（≥5 条）

| # | 用户话术（示例） | 意图 | 期望 operationId / Tool 顺序 | 期望行为 |
|---|---|---|---|---|
| 1 | 「绑定一下 ERP」 | 绑定 | `binding.issue` → 用户 ERP claim | 返回 8 位码；不索要密码 |
| 2 | 「我绑好了吗？」 | 绑定状态 | `binding.status` | bound/erpLoginName 来自 ERP |
| 3 | **「查原料仓表面活性剂还有多少」** | **库存** | `stock.query(query, depotName)` | 数字 REAL_ERP；无仓权限则 403 |
| 4 | 「RM-A001 各仓库库存」 | 库存 | `stock.query(barCode)` | 多行 rows |
| 5 | 「表面活性剂」仅一名称 | 物料歧义 | `material.search` → 若 ambiguous 追问 barCode | 不猜编码 |
| 6 | **「再采购 10 升 RM-A001，还是上次那家供应商，入原料仓」** | **采购+历史供应商** | `bill.search(purchase,days=90)` → `partner.search` → `stock.query`? → `purchase.prepare` | 供应商须来自历史或搜索；草稿提示未入库 |
| 7 | 「确认入库吧」 | 误触发 COMMIT | 无 Tool | 拒绝；说明 015B 可信确认 |
| 8 | 「取消刚才那个草稿 108」 | 取消 DRAFT | `draft.cancel(108)` | cancelled；库存不变 |
| 9 | **「最近一周采购入库汇总」** | **分析** | `report.query(purchase_in_summary,days=7)` | totals 或 hint；不编造 |
| 10 | 「GW-PURCHASE-94 明细」 | 单据穿透 | `bill.detail` | 行级 qty/单价；仓库授权 |
| 11 | **「最近有没有配制 FG-101 的单子」** | **配制只读** | `bill.search(mix)` → 可选 detail | 不说成销售 |
| 12 | **「苏州精密这个月耗料多少」** | **耗料报表** | `report.query(service_consume_by_customer, partnerName)` | 客户维度汇总 |
| 13 | 「帮我在企微里做一张服务耗料单」 | 未实现 write | 无 prepare Tool | 说明 service.prepare planned；可指 Demo |
| 14 | **「给我一份采购入库 Excel 模板」** | **Excel 模板** | 引导 `excel.template(PURCHASE)`（会话/Demo） | Agent 不伪造文件 |
| 15 | **「我发你填好的 xlsx 帮我看看能不能导入」** | **Excel 预览** | 渠道上传 → `excel.preview` | posted=false；展示 summary |
| 16 | **「第 3 行供应商名称不对，我改好了再传」** | **Excel 修正** | 再次 preview | 不 confirm |
| 17 | **「预览 OK，我在网页点确认了」** | **Excel 确认** | 用户 UI → `excel.confirm` | Agent 不代点；可解释 batchId |
| 18 | **「把刚才导入回执发我」** | **Excel 回执** | `excel.receipt(batchId)` | 仅 owner 可下 |
| 19 | 「期初库存模板也能直接入库吗？」 | SALE/INITIAL | 无 | 明确 INITIAL/SALE 不可 confirm |
| 20 | 「换绑：先解绑再绑新 ERP 账号」 | 换绑 | `binding.unbind` → `binding.issue` → claim | 旧草稿代际不可访问（403） |
| 21 | 「我是仓管小王，查成品仓 RM-A001」（无成品仓权限） | 权限拒绝 | `stock.query` | 403；说明 UserDepot |
| 22 | 「查供应商华东化工」（存在两条同名） | 同名供应商 | `partner.search` 多条 | 让用户选 partnerId/全名 |
| 23 | 「确认采购」且存在 #106、#108 两个 DRAFT | 多草稿 | 无 confirm | 要求指明 draftId；禁止猜 |
| 24 | 用户重复发「确认采购106」网络抖动 | 重试 | 015B `draft.confirm.wecom` replay | 同一 billNumber；库存不二次加（master） |
| 26 | **「按上次采购供应商买 10 升材料」** | 采购+历史供应商 | 同 #6 | 口语材料须 material.search；供应商来自最近采购 |
| 27 | **「这个月哪些客户消耗清洗液最多」** | 耗料分析 | `report.query(service_consume_by_customer)` + material 关键字 | 仅授权客户/仓库；不编造 |
| 28 | **「配制 5 升清洗液，材料不够怎么办」** | 配制缺料 | `material.search` → `stock.query`；无 mix.prepare | 说明缺料与补采购草稿选项；不伪配制过账 |
| 25 | 「群里帮大家查下库存」 | 群聊 | 拒绝 | WECOM_GROUP_NOT_ALLOWED |

## 重点场景展开

### A. 沿用之前供应商（#6）

1. 若用户未给 organName，从 `bill.search(purchase, limit=10)` 最近一条读 `partnerName`。
2. 用 `partner.search(supplier, query=…)` 验证启用；多条则列出。
3. 物料若口语，先 `material.search`。
4. `purchase.prepare` 固定 idempotencyKey（同一会话同一意图）。
5. 回复含 draftId、参考金额、**待确认未入库**。

### B. 原料仓库存（#3–#5）

- 必须带 `depotName=原料仓` 当用户指定仓。
- 403 时不得返回其他仓数据「凑合」。

### C. 配制 + 耗料 + Excel（#11–#19）

- 配制/耗料：019A 仅 bill/report/stock 只读；写操作指 016/019B 或 Excel/Demo。
- Excel：5 条覆盖 template / preview / 改错 / UI confirm / receipt；Agent 全程不调用 `excel.confirm`。

## 通过标准（019A Review）

- [ ] 24+ 条与 `erp-capabilities.yaml` operationId 一致
- [ ] 所有 COMMIT 场景 Agent 均不调用 Tool
- [ ] mix/service 未声称企微 prepare 已上线
- [ ] Excel ≥5 条且 INITIAL/SALE 边界清晰
