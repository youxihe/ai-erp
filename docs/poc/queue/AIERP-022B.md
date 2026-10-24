# AIERP-022B · 写操作完成后自动 PDF 发送与真实送达回执

状态：**CODE_READY** / branch `feat/aierp-022b-receipt-auto-delivery`（基于 origin/master cf96c8dd）。
目标：企业微信本人提交成功的采购/MIX/SERVICE/主数据新增与更新/批次入库后，自动发送精简业务摘要 + **真正的操作回执 PDF 文件**，无需用户再要求“发我回执”。失败只重传回执，绝不重复提交业务。

## 本棒交付（SOP）

- `sop/receipt-auto-delivery.mjs`：PURCHASE/MIX/SERVICE 成功后统一 Bot WS PDF 投递；重发只走 receipt-send；022A partner/material/batch hook 位预留。
- `sop/wecom-outbound.mjs`：去掉 `dirname(abs)` 动态放宽；固定配置根 + `realpath` 校验。
- `sop/receipt-send.mjs`：`extractBillNumber` 支持 `GW-MIX-*` / `GW-SERVICE-*`；`billNumber` 覆盖；NEED_CHOICE 后裸 `GW-*` = 选回执（非再确认）。
- 送达状态：`PDF_READY` / `CHANNEL_ACCEPTED` / `CLIENT_OPEN_VERIFIED`（后者仅真人客户端打开后标记，适配层永不自动写）。
- 意图单测：`node deploy/scripts/aierp-022b-intent-unit.mjs`（并回归 015C intent/outbound）。

沿用 Bot WS uploadAndSendMedia。每种 receiptKind 匹配各自文件和业务摘要，不能用采购 PDF 代替 MIX 或 SERVICE，不能把 PDF 发送失败说成入库失败。只读请求“刚才的回执再发一遍”要查询同 bot/sender/tenant/actor/binding generation 当前允许的凭证及版本；权限失效拒绝。

对旧 #119/#136 只能只读补发/验证，不得再次过账。验收新测试操作仅在本人真实确认之后生成凭证及主动 PDF，PC/手机真实可打开；客户端未验证只能记 CHANNEL_ACCEPTED。无全路径/JSON/假成功消息，支持同一操作重试投递与限流。
