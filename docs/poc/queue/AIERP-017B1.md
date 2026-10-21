# AIERP-017B1 · Excel 有效预览 → 真实采购待确认草稿 → 本人确认（客户 Demo 快线）

- **状态**：RELEASED / next_order #1（017A PR #30 **已合并 `25d4c98f`**；立即开始实施；不再等待 #30 复审）。
- **分支**：`feat/aierp-017b1-verified-xlsx-purchase-confirm`
- **优先级**：最高客户 Demo，优先完成 **PURCHASE 一张合法采购单（可多行同单号）**；其它 MIX / SERVICE / SALE / 多单批量留 017B/017C，不要同一轮铺开。
- **目标场景**：用户上传预填/修改后的 Excel → ERP 真实校验并记录 PREVIEWED → 无需再次上传，用户直接说“确认入库” → 已绑定本人从最新 verified preview 创建**真正未审核草稿**，再走现有 015B 可信原文确认入库；最终返回原生已审核单号和库存变化。理想交互是在预览成功且只有 1 张完全合法采购单时，由服务器自动创建未审核草稿、向用户展示具体草稿号和摘要，用户只需回复一次 `确认采购{id}`，不再要求用户重复确认或重新传文件。
  
## P0 复用现有后端，禁止通用批量过账捷径

- 复用 `AierpExcelService.previewAs` / `aierp_excel_preview.payload_json` 中已标准化单据、`AierpGatewayService.createDraftAs(boundUser, PURCHASE, normalized, owner)`，以及现成的 015B **原始企微 before_dispatch 确认钩子与原生 confirmAs**。不得让模型把 preview row JSON/数量拼出来后调用普通 prepare；**Java 只能依据已校验的 previewId 重新读取数据库中稳定的 normalized rows**。
- 新增类似 `prepareVerifiedExcelPurchase(previewId)` 的受控服务端入口（或可信 Channel 文件工作流处理器在 PREVIEWED 后自动创建）与最少的 Adapter，无需设计全量 017C 批次事务。
- 创建 DRAFT 时安全校验：preview 所属可信 sender + bot + ERP tenant/user + binding generation + 文件 hash/版本，1 个业务单、全部行 canConfirm、行数据与当前物料供应商仓库权限一致。任何错误、2+业务单、MIX/SERVICE/SALE 都明确转完整 017B/017C 或只显示预览，不自行过账。
- 强制防重复：同一 preview/file hash+业务单同一绑定只能创建一张 DRAFT；同文件重复发送/WS 重试/会话重启不得重复建草稿。出现后续新 Excel 上传时旧未审核草稿/确认挑战失效，或明确询问用户是修改还是新采购。
- 预览 ID/有效草稿号均由 ERP Redis/DB 持久化，以 sender+bot+binding_generation 查询**最近一次有效预览**，不依赖模型会话历史；用户说“入库吧”时如果 DRAFT 已生成，只提示真实有效的单据摘要和唯一明确确认文本，不谎称文件不存在。
- 原生过账仍只能通过可信 original WeCom inbound hook 或已登录 ERP PC/H5，**不是 Model Tool confirm**；真实入库前应提醒用户将改变库存并等待精确确认 `确认采购{draftId}`。用户原文“确认入库”仅在服务器能证明只有一个匹配且内容无变更的待确认草稿、且已给用户展示过完整摘要时可受控使用，否则必须让其确认具体单号。
- 旧草稿 #113 由错误文件名猜测创建，**不得自动确认**。新测试一律专用测试 preview /草稿；不重跑 #111 实时入库。

## 用户对话标准（最少步骤、业务口吻）

成功收到用户上传的采购 Excel：
```
Excel 已核对：采购单 T-20261021（1 张 / 1 行）
供应商：华东化工
表面活性剂 RM-A001｜原料仓｜100 L × 20 元/L＝2000 元
没有错误，尚未入库。
已生成待确认采购单 #{realDraftId}。
请回复「确认采购{realDraftId}」完成入库，或「取消」。
```
- 用户发“入库吧”：有唯一有效已准备 DRAFT 时，回复“请回复「确认采购{id}」以正式入库”；**不得**回复“请重传 Excel/会话重置/没有 previewId”。
- 错误上传：只说业务问题，如“第4行缺少采购单号，请补上后重新发文件”；错误行号来自 `sourceRows` 而不是 null；不要将 status、previewId、raw JSON 暴露给用户。
- 后端成功原生过账：真实单据号、已审核、采购金额、库存变动、回执；PDF 如果尚未从企微发成功，就只说“回执已生成，可在 ERP 查看”，不能说“附件已发出”。

## 验收

1. **不修改库存**：用真实企微一次上传采购 XLSX（业务单号 T-20261021、100L、20元/L、华东化工）→ server PREVIEWED → 对应同一 previewId 的真实未审核 DRAFT 自动生成（或明确语句触发），不再要求重传；库存仍 170.7 L（视最新实际库存）。
2. 发送“入库吧”时回复当前 DRAFT 的确认指令，且用户即使 `/new` 开新会话，仍能按当前可信绑定找到未过期 DRAFT；提示不会泄露给其他企微用户。
3. 同一文件重复上传或重复消息不会生成第二个 DRAFT，用户修改数量/价格后旧预览/挑战必须失效。
4. **单次真人明确确认** → 原生已审核单号/真实库存变化；必须是专门演示测试草稿，禁止自动确认已有 #113/#111。
5. 低权限、跨租户、换绑、用户停用、仓库撤权、文件含错误、2+业务单、同名物料歧义均拒绝准备或明确引导批量流程。
6. 自动化和真人 UAT 分开记录，新 HEAD + 无过账回归；Cursor Push READY_FOR_REVIEW，ChatGPT Review/Merge，Cursor 不自行 Merge。

## 后续

单张采购 Excel Demo PASS 后再把 `017B` 扩为 PURCHASE 多单批次、MIX 配制生产、SERVICE 服务耗料、SALE 真实销售出库；`017C` 再做批次一次确认/部分成功与 XLSX/PDF 回执。**不再将通用 Agent 019B 架构实施排在客户可用 Excel 闭环之前**。

## 客户 2026-10-22 07:10 UAT 特别注意
Excel 业务单号 `CG-20261021-230716-ACC9` 对应 **80 L × 20 = 1600 元**，并非 ERP 的数字草稿号。它是前台外部业务单号，不能拿 `确认采购CG-...` 作为原生 draftId。用户先口头 20 L，后 Excel 改为 80 L；**以最新有效 Excel 单元格 80 L 为准**。最终消息在首次有效 Excel 预览后就应包含真实未审核数字草稿号以及唯一确认短语，完成一轮确认。不得要求“取消文件”再按旧 20L 口头做单，也不以不存在的原生 ID 查询 CG-...。
