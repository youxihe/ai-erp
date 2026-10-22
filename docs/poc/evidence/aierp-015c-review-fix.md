# AIERP-015C · Review Fix：真实企微 PDF 附件（非 MEDIA 文本）

## 根因

1. `before_dispatch` 返回 `{handled:true,text:"...\\nMEDIA: F:\\\\..."}`：**不会**走 OpenClaw/WeCom 出站媒体解析；用户看到路径字面量。
2. `channels.wecom.mediaLocalRoots` 仅有 `aierp-excel`，未包含 `aierp-receipt`。
3. 「文件直接发我」未接续回执 pending，模型误调 `erp_excel_template`。

## 修复

- SOP：`plugins/aierp-erp-tools/sop/receipt-send.mjs` + `registry.mjs` + `renderers/wecom-business.mjs` + `wecom-outbound.mjs`
- 出站：优先调用本机 `@wecom/wecom-openclaw-plugin@2026.7.2` 的 `uploadAndSendMedia` + Bot WS（真实文件消息）；**拒绝** channel `sendMedia` 失败时把 `📎 F:\...` 路径当文本发出的降级
- pending：`state/aierp-receipt-pending.json`，支持「文件直接发我 / 重发」
- `before_tool_call` 拦截：有 pending 回执时禁止 `erp_excel_template`
- 确认/回执文案：Markdown 层级 + `<font color="info">` + `80 L` / `¥1,600`，禁止 JSON/路径
- `mediaLocalRoots` 增加 `F:/aierp-openclaw/state/media/aierp-receipt`
- F: 已热更插件并重启 Gateway（HTTP 200）

## 自动化

- `aierp-015c-outbound-unit.mjs`：意图/接续/渲染/插件发现
- 既有 `aierp-015c-receipt-file.mjs`：HMAC PDF bytes（只读，库存不变）

## 真人 UAT（请用户）

1. `/new` 后发：`发 GW-PURCHASE-119 回执` → 应收到 **PDF 文件消息**（可打开），正文无 `MEDIA:` 路径  
2. 再发：`文件直接发我` → **同一 PDF**，不是 Excel  
3. 库存仍为 250.7 L；不新建采购

`PDF_SENT_VERIFIED` 仅在客户端打开成功后标记。
