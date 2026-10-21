# AIERP-017A · 企微 Excel 模板 / 预览证据

**分支**：`feat/aierp-017a-wecom-xlsx-inbound-preview`  
**范围**：模板发送（HMAC base64）+ 回传预览；**不**调用 `excel.confirm`；库存与已审核单据不变。

## 实现摘要

| 项 | 说明 |
|---|---|
| Java | `AierpExcelService.templateAs` / `previewAs`；`AierpWecomExcelService`；`POST /aierp/v1/wecom/excel/template\|preview` |
| OpenClaw | `erp_excel_template` + `message_received` 入站 xlsx 预览钩子；**无** confirm Tool |
| SALE | 仅模板，`confirmSupported=false`；预览返回业务拒绝 |

## 自动化

脚本：`deploy/scripts/aierp-017a-excel-preview-flow.mjs`  
JSON：`docs/poc/evidence/aierp-017a-excel-preview-flow.json`

**ALL_PASS 14**：PURCHASE/MIX/SERVICE 模板+预览；SALE 仅模板；库存 170.7 不变；已审核单数不变。

## 真人 UAT（待）

1. 企微：「给我批量进货模板」→ 收到可下载 xlsx（`MEDIA:`）  
2. 填一行后发回 → 预览摘要、明确未入库  
3. MIX/SERVICE 各一轮；销售出库说明仅模板  

## 仍不做（017B/C）

批次 DRAFT、`确认批次`、原生批量过账、`excel.confirm` 模型工具。
