# AIERP-015B · OpenClaw / WeCom 可信确认探针证据

## 安装版本结论

本机 `F:\aierp-openclaw` 未重装/升级。官方 `@wecom/wecom-openclaw-plugin` 与 OpenClaw SDK **实际提供**：

| Hook / 字段 | 可用性 | 用途 |
|---|---|---|
| `api.on("before_dispatch")` | **可用**（`PluginHookBeforeDispatchEvent`：`content`/`body`/`senderId`/`messageId`/`isGroup`/`channel`） | LLM 之前拦截「确认采购{id}」原文 |
| `api.on("before_prompt_build")` | 可用（官方企微插件已用） | 仅注入提示，不替代确认 |
| `ctx.requesterSenderId` + `messageChannel==="wecom"` | 可用（012A 已验证） | 工具身份 |
| 模板卡片回调 | 未作为本轮确认主路径 | 保底仍保留 ERP session `confirm-ui` |

**结论：非 `BLOCKED_TRUSTED_CONFIRM_EVENT`。** 确认走 `before_dispatch` → HMAC `POST /aierp/v1/wecom/draft/confirm`（`eventSource=WECOM_BEFORE_DISPATCH`），**不注册** `erp_draft_confirm` 模型工具。

## 插件变更

- `deploy/openclaw/plugins/aierp-erp-tools/index.js`（同步 `F:\aierp-openclaw\state\extensions\aierp-erp-tools\`，修改前备份 `*.bak-015b-*`）
- `botId()`：`AIERP_WECOM_BOT_ID=default` 时回退到真实 `WECOM_BOT_ID`
- `before_dispatch`：匹配确认短语后直达 Java；群聊/无 sender 不处理

## PDF 企微送达

- 服务端可生成 A4 中文 PDF（容器需 `fonts-wqy-microhei`）。
- 官方插件通过 `MEDIA:` / wecom-send-media 技能发文件；**本轮自动化未完成真人客户端打开验证** → 标记 `PDF_DELIVERY_NOT_VERIFIED`。
- 文本回执为 P0；ERP session 可下载 PDF（`/aierp/v1/wecom/receipt/pdf`）。禁止 localhost 外链冒充可达。
