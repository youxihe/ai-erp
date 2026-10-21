# AIERP-017A Round4 Review Fix

## PR #30 close reason

GitHub PR #30 为 **CLOSED / NOT MERGED**（控制面 #33 合并时由维护者关闭）。源码未进 master。本轮在原分支 `feat/aierp-017a-wecom-xlsx-inbound-preview` 同步 master 后继续修复，并重新打开/替代 PR。

## Live file parse status

真人企微 XLSX → ERP PREVIEWED 已在 Round4 前通过（例：`T-20261021` / 100L / 华东化工）。**不再重复上传同一目的的验收。**

## Code fixes

1. 删除 `purchasePrepare` 对模型参数 `excelWorkflowCancel:true` 的门禁旁路；仅可信「取消文件」→ `/excel/workflow/cancel`。
2. Excel 模板：不用 jshERP 原生 `.xls` 导入格式（列结构不同、无业务单号分组）；增强 AI-ERP XSSF 模板——红必填/灰选填、说明页、预填唯一单号+日期、冻结表头、筛选、仓库/单位下拉、列宽。
3. 用户文案：`userSummaryZh` 业务口吻；去掉 PREVIEWED / previewId / canConfirm / 行null。
4. Redis 工作流保留 `previewId` + `userSummaryZh`；「入库吧」走 `before_dispatch` 读取服务端有效预览，不否认已核对文件。
5. 保留 13 模型工具 + 015B 确认钩子；不暴露 excel.confirm；不确认 #113。

## Tests

- `aierp-017a-filename-vs-cells`：**10/10 PASS**（含 `excelWorkflowCancel:true` 负例、`userSummaryZh`、workflow 摘要保留）
- `aierp-017a-excel-preview-flow`：**14/14 PASS**；库存 170.7 不变
- Gateway：HTTP 200；企微通道 `running, works`
- HEAD：`a319848b` · `REVIEW_FIX_PUSHED`
- 勿确认 #113；017B1 等本 PR Merge 后再开

## PR

分支已 Push。若 #30 仍为 CLOSED，请维护者 Reopen 或开替代 PR 指向本分支（Cursor 不自行 Merge）。
