# AIERP-017B2 · 多张采购 Excel → 多草稿与批次状态（下一棒 P0）

- **状态**：RELEASED / next_order #1；分支 `feat/aierp-017b2-multi-purchase-draft`，从最新 master 独立开工。
- **范围**：PURCHASE 多张业务单（同业务单号多物料行）→ 校验 → 服务端从每个已验证 `preview.record.normalized` 创建**多张真实未审核** ERP DRAFT → 展示可核对批次清单，不修改库存。
- **复用**：017A 企微 XLSX 媒体/preview，017B1 可信预览归属/数字草稿 ID，015B/015C 原生确认及 PDF 回执，020A 业务 SOP。不得让模型传任意 API/SQL 或模型确认工具；不得调用旧 `excel.confirm`。

## 开工前必须先修 P0 重放状态
2026-10-22 16:49 真人重新上传已审核 XLSX，机器人又报“待确认 #119/未入库”，确认后返回既有 GW-PURCHASE-119，库存没有证据二次改变。服务端按 **preview-file hash + businessKey + bound actor + 当前原生已审核状态** 做唯一性和状态重查：已审核 → 回复「已完成/可重新领取回执」，不再创建/展示待确认 DRAFT；取消/过期/失败按真实状态展示。不以旧预览缓存判定真实过账状态。多张单同理。

## 具体开发范围
1. `aierp_excel_preview.payload_json` 已按 businessKey 合并明细；保持原 Excel 每张采购单分组。审计原 `mergeGroup`：同一 businessKey **供应商/业务日期/仓库等单据级字段冲突必须报错**，不允许把两个供应商暗合成一张单。原料仓权限/价格/单位/数量/供应商逐行重新校验。
2. 建立服务端批次与子单明细：`batchId, previewId, fileSha256, revision, trusted bot/sender, binding generation, ERP tenant/user, businessKey, normalized hash, draftId, state, error, nativeBillNumber`；不依赖会话历史。单一文件一张单仍兼容 017B1，不重复建单。
3. 一张上传文件最多 200 行、2MB（暂沿用现有限制）。一个文件 2 张以上采购单，返回“共 X 张、有效 Y 张、错误 Z 张”；**错误不可静默忽略**，必须用户明确选择仅处理有效单据后才创建草稿；逐行说明行号和修改建议。
4. 同文件重复上传、重复 messageId、/new、WS 重试、并发请求均不能重复创建草稿；文件更改后旧预览/确认挑战失效，但**已审核原生单据绝不可因文件更改被取消或重复审核**。
5. 提供明确的 `purchase_batch_prepare` 受控 SOP/API，**不是**给 LLM 任意 `erp_draft_confirm`。仅模型展示参数/选择，Java 从权威预览读取真实明细。批次确认留 017C1 实现，017B2 不直接过账；已经支持的“逐个数字草稿号可信确认”可作为兼容保底，但要明确展示每单状态。
6. 简洁企微回复：`批量采购已核对：3张 / 6行；2张可办理、1张有错。` 展示最多3张业务单号、总额、数量（只在同单位时求和），下一步唯一选择；不要输出 raw JSON、内部 status、previewId 或文件路径。

## 代码测试 & Review 门槛（不入账）
- 2 张单/3 行（第一张 2 行第二张 1 行）→ **恰好 2 个真实 DRAFT，库存不变**；2 次上传/并发只 2 张 DRAFT。
- 1 张已审核的旧 XLSX #119 → 真实已审核历史单及 PDF 回执，无新的 DRAFT/入库；不能写“未入库”。
- 同一 businessKey 不同供应商 → 校验阻断；一行错误+一行有效 → 明确列出错误且不自动过账。
- 低权限/撤仓库/换绑/跨企微/过期/改文件，禁止访问旧草稿、原生单据。
- 保留 13 模型工具、015B 原始可信确认钩子和 015C PDF 文件发送。Push READY_FOR_REVIEW，HEAD 与 non-post tests；Cursor 不自行 Merge。
