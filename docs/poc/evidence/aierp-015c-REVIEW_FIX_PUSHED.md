# AIERP-015C REVIEW_FIX_PUSHED

- HEAD: 14ddd978b627f2e6ddf61262dc4d861b40c0080f
- Branch: feat/aierp-015c-wecom-real-receipt-pdf
- PR: https://github.com/youxihe/ai-erp/pull/37
- Outbound: Bot WS uploadAndSendMedia (no MEDIA:/path text)
- Unit: outbound + receipt-file ALL_PASS
- Gateway: http://127.0.0.1:18789/ = 200
- F: plugin synced; awaiting client PDF open for PDF_SENT_VERIFIED

UAT:
1. /new
2. 发 GW-PURCHASE-119 回执
3. 文件直接发我
