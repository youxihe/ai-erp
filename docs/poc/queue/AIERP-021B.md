# AIERP-021B · 企微对话创建/修改原料与物料主数据

- **状态**：REVIEW_FIX_PUSHED（ChatGPT Round 1 修复已推送；勿 Merge；不能与 021A 或 017B2/016M/016S 多分支同时覆盖 F:）
- **分支**：`feat/aierp-021b-material-masterdata-sop` from latest master。
- **目标**：用户说“新原料 XXX，编码 RM-...，单位 L；加入 ERP”“把 RM-... 规格改为 ...”→ 按 ERP 的 `Material + MaterialExtend`（物料主档 + 实际条码/SKU）真实落地。添加后可直接通过 ERP 物料检索、采购 XLSX 或 MIX 配制查询使用。

## 实码审查结论与重要业务风险

- 原生 `MaterialController POST /material/add` 和 `PUT /material/update`，内部 `MaterialService.insertMaterial/updateMaterial` 会操作 `MaterialExtend`、SKU/多单位并且**如果请求带 stock 初期库存字段还会创建/重置初始及当前库存**。这不是安全的“简单建原材料”接口。
- 适配时**不能**直接将模型任意 JSONObject 或用户 `stock` 字段传递到原生接口；使用受控 `MaterialMasterDataService.prepareMaterial/commitMaterialAs(User actor,...)`（镜像 #44 `PartnerMasterDataService`；禁止共享旧 `AierpWecomMasterDataService`），在白名单字段、现有分类/单位/sku校验后明确写入；绝不能在本功能碰 `jsh_material_current_stock`、`jsh_material_initial_stock`、原生 depotHead 或已有库存。新增物料初期库存必须 0，初期设置/盘点需独立 ERP 业务（本棒禁止）。prepare 与 commit 均须重验原生「商品信息」RoleFunctions。
- 原生 MaterialService 的子表 saveDetials 和部分异常返回处理要仔细读，真正落库**事务原子性** + tenantId 上下文 + MaterialExtend/bar_code 主数据一致性是验收要求。不要伪造 RequestContextHolder/HttpServletRequest 也不能共享 admin。

## MVP 业务字段与校验

- 创建：**物料名称、唯一物料条码/编码、单位**（必填）；**物料类别、规格/型号、品牌、备注**（视 ERP 要求必填/选填），仅引用当前租户已存在的 ERP 分类和单位，不允许模型自建临时分类/单位；如缺类别，直接列出已有类别让用户选择。
- 物料类型由 ERP 当前支持的分类/物料属性决定，不根据“原料”“成品”字眼瞎写数据库类型。实际物料编码位于 `jsh_material_extend.bar_code`，必须插入/更新对应单位/SKU 子记录后可按码立即检索；同条码租户内不得重复，名称+规格同名/近似先推荐候选避免错误重复建档。
- 修改：仅允许名称/规格/品牌/备注等普通资料；编码和基础单位如已有关联单据或库存**本棒禁止修改**（否则历史单据关联和计量风险），需要单独维护流程。类别迁移、期初库存、历史库存、批号/保质期、成本价、启停/删除属于独立评审。
- 对话收集字段→`master/material/prepare` → 向本人显示“新增原料 XXX｜编码 RM-...｜单位 L｜分类…”或真实旧新差异 → 原始可信私聊 `确认建档物料{申请号}` / `确认修改物料{申请号}`（物料命名空间，禁止裸 `确认建档{id}`）→ `master/material/commit`（必须 `eventSource=WECOM_BEFORE_DISPATCH`）。LLM 不能直接调用 commit，创建后只读验证 ID/barCode/tenant/sku。
- 按 User 真实角色功能权限、租户/绑定 generation 重验，requestID/业务 hash/已存在 master 版本绑定一次性挑战；相同 request 重放不得第二次创建/修改。

## 演示联动
- “采购一种还没录入的原料” → 搜索不到 → Agent 采集必要字段 → 请本人确认建档 → ERP 真实新物料可检索（**库存仍为 0**）→ 返回未完成的采购草稿或 Excel 文件业务，用户只需补之前缺失的信息，不重说整个需求。
- 若曾经有已审核历史采购，不能更改 SKU 或通过“新建”覆盖历史；拒绝重名/同码危险操作。
- “配制 FG-101，原料少一种 XXX” → 流程挂起并建档新原料，但不推断化学配比/计量单位，也不因为“建档成功”自动领料/审核。

## 测试
1. 当前真实 ERP 中选存在的分类和单位，新增一个唯一 RM 编码测试原料 → `jsh_material + jsh_material_extend` 均真实保存，可按条码读取，全部仓库库存 0；同请求重发只有一条。
2. 修改测试原料的备注或规格 → old/new diff + 本人确认 → 真实 ERP 读回；原编码/库存/旧单据不变。
3. 无必填单位/错误条码/重复条码/近似名称/不正确类别/跨租户/用户撤权/重绑/同名异 SKU/并发均合理失败或提示选择。
4. 真企微成功后用该 RM 编码准备一张**未审核采购草稿**（不真实过账），供应商可通过 021A 建立；并验证无权限不能建档。
5. 全过程没有初始库存修改，没有“创建物料即入库”；截图脱敏、nonposting 安全回归、READY_FOR_REVIEW、Cursor 不自 Merge。
