# AIERP-015C UX fix（企微文案 + 自动发 PDF + 回执表格）

## 问题
1. 确认/回执正文出现字面量 `<font color="info">…</font>`（before_dispatch 文本通道未按 Markdown 渲染）。
2. 确认入库后只提回执文件名，需用户再发「发回执」才收到 PDF。
3. PDF 库存变化是 JSON 字符串，数量 6 位小数。

## 修复
- WeCom renderer 默认 **plain**，禁止输出 `<font>`。
- `确认采购` 成功后 **自动** `runReceiptSend` 发真实 PDF。
- PDF：物料表 + **库存变化明细表**（编码/仓库/入库前/入库后/变动），数量去尾零。
- `receipt/file` 按 `receipt_json` 刷新 PDF；`docker-compose` 增加 `aierp_receipt_data` 持久化。

## 验证
- outbound-unit ALL_PASS（含 `render_no_font_tags`）
- receipt-file ALL_PASS（GW-PURCHASE-119 只读，库存不变）
- 刷新后 PDF 含「库存变化明细」表：`RM-A001 原料仓 170.7 → 250.7 (+80)`

## UAT
1. `/new` → 对**新**待确认草稿走确认（勿重复采购 119）：确认后应**直接收到 PDF**，正文无 HTML 标签。
2. 或对已审核单：`发 GW-PURCHASE-119 回执` → 打开 PDF 可见库存变化表格。
