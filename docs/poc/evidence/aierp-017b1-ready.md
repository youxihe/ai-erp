# AIERP-017B1 READY_FOR_REVIEW

## HEAD

见 git push 后最新 commit。

## 行为

1. 企微回传单张合法 PURCHASE XLSX → ERP preview → **服务端**从 `aierp_excel_preview.payload_json` 创建未审核草稿（数量来自单元格，非模型）。
2. 回复含 Excel 业务单号 `CG-...` 与数字 `draftId`，确认短语 `确认采购{draftId}`。
3. 同文件幂等；改文件 SHA 则取消旧草稿并建新草稿。
4. 口头 `erp_purchase_prepare` / `excelWorkflowCancel` 旁路在 DRAFT_READY 时仍 409。
5. 确认仍走 015B `before_dispatch`；无 `excel.confirm` 模型工具。
6. 勿确认 #113。

## 本地无过账

- `aierp-017b1-verified-draft`：**11/11 PASS**（80L 单元格、idempotent、改文件作废旧草稿、库存不变）
- `aierp-017a-filename-vs-cells`：**11/11 PASS**

## 真人企微

请用户发**新**专用采购 Excel（建议 80L×20 / 华东化工 / 原料仓）→ 应直接看到待确认数字草稿号 → 回复 `确认采购{n}` → 原生入库。**不要**确认 #113。

`LIVE_WECOM_CONFIRM=PENDING_USER`（需用户本人确认专用新草稿）。
