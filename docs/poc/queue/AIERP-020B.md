# AIERP-020B · 企业微信原生业务卡片与多明细展示

状态：**CODE_READY** / visual #1。分支：`feat/aierp-020b-wecom-native-card-renderer`，从 master `cf96c8dd`。
目标：商品名称/编码、数量、单价、行金额、整单合计、状态高辨识度；2 业务单/3 行不遗漏第二行，不拿首行金额充当整单合计。

## 交付摘要

1. **Capability matrix**（本机只读探针）：`docs/poc/evidence/aierp-020b-wecom-capability-matrix.md`  
   安装 `@wecom/wecom-openclaw-plugin@2026.7.2` + `@wecom/aibot-node-sdk@1.0.7` 支持 Bot WS `markdown` / `template_card`(text_notice|news_notice|button_interaction|…) / `image` / `file`。`before_dispatch` 文本路径仍只能发纯文本，禁止 `<font>` / `MEDIA:`。
2. **WeCom adapter**：`sop/renderers/wecom-adapter.mjs` + `wecom-capability.mjs` + 多行修复的 `wecom-business.mjs`  
   - `extractPurchaseLines` / `sumLineAmounts`：全明细 + 行金额合计  
   - `renderPurchaseConfirmed` / `renderPurchaseDraftReady` / `renderPurchaseBatchDraftReady`  
   - `text_notice` 卡片 + 可选 `button_interaction`（仅 `view_confirm_phrase` / `copy_confirm_phrase`）  
   - **禁止** jump_list type=3 携带确认指令（会自动发送并绕过可信原文确认）
3. **确认路由保留**：PURCHASE / MIX / SERVICE 仍走既有 `before_dispatch` 可信短语；卡片按钮不得过账。
4. **单测**：`deploy/scripts/aierp-020b-wecom-card-unit.mjs` → `docs/poc/evidence/aierp-020b-wecom-card-unit.json`

## 约束回顾

先读取官方 WecomTeam 的 SDK 和 **F: 实际安装** @wecom/wecom-openclaw-plugin 的源码：真实测试 text_notice/news_notice/button_interaction、Markdown、图片、文件/混排在当前 Bot WS 的 API、PC 和手机效果，形成 capability matrix，标明 SDK 支持但安装版本不支持的类型。不能 plain text 里填 font/Markdown/MEDIA 路径。用户真的可以收到和打开才算交付。

按 BusinessResult DTO 实现 WeCom 独立 adapter：status card、purchase lines、MIX 配制、SERVICE 出库、error、明细表格 PNG；先 PC 成功，再手机。卡片按钮仅查看/下载/复制确认指令，不可绕过可信原始用户确认进行入库。飞书 adapter 只定义共享语义，不硬复用企微 JSON。

修改当前 first-line-only 渲染，完整多行展示，行价格/金额总计来自 ERP 结构化事实。降级为干净纯文本或图片时仍保证数字准确，无 raw JSON、6 位小数噪声、本地文件路径。PC/手机截图、SDK 真实 msgtype 和送达日志、非过账测试是验收证据。
