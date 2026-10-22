# AI-ERP Cursor Agent · 015C READY_FOR_REVIEW

**分支**：`feat/aierp-015c-wecom-real-receipt-pdf`（基于 master `f666e183`）

**已完成（本机）**
1. Java：`/aierp/v1/wecom/receipt/find` + `/receipt/file`（HMAC；本人/租户/binding_version/仓库权限；PDF sha256 + 路径防穿越）
2. OpenClaw：`before_dispatch` 优先识别回执意图 → 真实 PDF `MEDIA:`；禁止用 `erp_excel_template` 冒充回执
3. 只读验收：`GW-PURCHASE-119` PDF 取出成功，库存未变；意图单测 PASS；017B1 #35 安全补丁非过账 **11/11**
4. F: 插件备份后同步；Gateway `restart.ps1`；未重装

**待用户企微 UAT**：私聊「发 GW-PURCHASE-119 回执」→ 收到并可打开 PDF → 才可标 `PDF_SENT_VERIFIED`。Cursor **不自行 Merge**。

证据：`docs/poc/evidence/aierp-015c-receipt-send.md`
