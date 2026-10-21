# AI-ERP Cursor · 下一棒 AIERP-017B1（单张采购 Excel 一次确认真实入库）

GitHub `master`：**AIERP-017A PR #30 已 Merge `25d4c98f`**；015B #27 可信原文采购确认已 Merge；019A API/SOP 已 Merge。AIERP-017B1 已正式 RELEASED。**无需再请求用户上传以证明解析；用户已经得到真实 Excel 预览。**

## 立即执行（优先于所有其他任务）

1. 从最新 `origin/master` 建 `feat/aierp-017b1-verified-xlsx-purchase-confirm`，阅读 `docs/poc/queue/AIERP-017B1.md`，不要从旧 #30 分支派生。改动 F: 唯一 OpenClaw 实例前先备份，必要时复测刚由 ChatGPT 追加的 017A actor/bindingVersion 保护。
2. **完整接通一张采购单**：真实企微 XLSX → ERP `aierp_excel_preview.payload_json` 中验证单据、明细 → 根据可信本人+唯一最新有效预览**在 Java 后端创建真实未审核 DRAFT** → 返回真实 **数字 draftId** 和确认短语 `确认采购{id}`。允许多行同一个业务单号，合并为一张原生单据。Excel 业务单号 `CG-...` 必须单独显示，**不能当 draftId 使用**。
3. 客户最后上传的有效 Excel 示例为 **80 L × 20 元＝1600 元**，原料仓、华东化工；之前聊天最初提过的 **20 L × 20 元＝400 元** 已被用户编辑的 Excel 覆盖。**在演示中严格以最新用户文件单元格为准**，不得出现 20 L 口头草稿或文件名推断。正式测试使用用户本人允许的专用新草稿，不碰错误来源旧草稿 #113。
4. **不需要双重确认/取消文件/再上传**：文件解析合法且唯一采购单时，服务端可自动生成 DRAFT 并回复核对摘要；用户只需回复一次可信 `确认采购{数字draftId}`。若用户先说“入库吧”，服务端用 sender/bot/binding_generation 直接找回 DRAFT，回复唯一确认指令和真实明细，不要让用户另行口头报数量。原生过账只走 015B 独立可信 `before_dispatch`，不开放通用 Model Tool `erp_draft_confirm` 或 `excel.confirm`。
5. 用户看到的消息最好不超过 6 行：`采购单 CG-...｜华东化工`，`表面活性剂 RM-A001｜80 L × 20 元 = 1600 元`，`原料仓｜未入库`，`待确认单 #<数字>`，`回复“确认采购<数字>”入库`。失败只解释缺哪个业务字段/第几行，无英文 previewId/status/JSON；不要念叨系统分期、内部安全机制和冗长二选一。
6. 文件预览的归属、文件 hash/修订版本与 ERP 用户授权都由服务端检查；多来源/多草稿不自动选择。重复上传/消息/并发建草稿幂等；文件重传改数量则旧待确认单撤销或过期；断线/换会话只读取可信服务端数据。成功原生确认后返回真实单号、已审核、库存增量、文本回执；PDF 附件未实测发送时不得假称已送。
7. 先跑无过账自动化和 actor/binding 恢复场景，再使用**全新专用测试采购单**由用户企微本人确认一次做实际入库。绝不自动确认 #111 / #113 或复用已有测试单；Cursor 不自行 Merge。提交 `READY_FOR_REVIEW`、HEAD、脱敏业务与库存证据，等 ChatGPT Review。

**不要**在 017B1 启动 019B 通用 Agent Gateway、019C 复杂报表或 017B/C 多单批量开发；客户 Demo 最短闭环优先。
