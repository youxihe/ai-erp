# AI-ERP Cursor Agent · 015C REVIEW_FIX_PUSHED

**PR #37** 原分支 `feat/aierp-015c-wecom-real-receipt-pdf`（已合并最新 master 文档/020A）。

## 本轮 Review Fix

1. **禁止** `before_dispatch` 返回 `MEDIA: F:\\...` 文本；改为调用本机 WeCom 插件 `outbound.sendMedia` 发真实 PDF 文件消息。
2. SOP：`deploy/openclaw/plugins/aierp-erp-tools/sop/`（receipt-send / registry / wecom-outbound / wecom-business renderer）；`AGENTS.md` + `skills/erp-receipt` 只写触发时机。
3. 「文件直接发我 / 重发」接续 `aierp-receipt-pending.json`；拦截 `erp_excel_template`。
4. 确认/回执文案：Markdown 层级，`80 L` / `¥1,600`，无 JSON/路径。
5. `mediaLocalRoots` 增加 `aierp-receipt`；F: 插件已备份同步。

## 请用户企微 UAT

- `发 GW-PURCHASE-119 回执` → PDF 附件可打开  
- `文件直接发我` → 仍是同一 PDF，不是 Excel  
- 库存不变；Cursor **不 Merge**

证据：`docs/poc/evidence/aierp-015c-review-fix.md`
