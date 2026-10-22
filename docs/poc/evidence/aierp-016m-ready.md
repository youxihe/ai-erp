# AIERP-016M READY_FOR_REVIEW

## HEAD

`416cdb442983dd8bb5fa023b69adf38a260bd495` (`feat/aierp-016m-mix-sop`)

## 行为

1. 企微回传单张合法 MIX XLSX（同配制单号多行原料）→ preview → 服务端从 `payload_json` 建未审核 MIX 草稿；库存不变。
2. 确认短语仅为可信原文 `确认配制{数字draftId}`（before_dispatch / `sop/register-mix-confirm.mjs`）；裸「确认」与「确认采购{id}」拒收。
3. 对话槽位 `POST /aierp/v1/wecom/mix/prepare` 须 `recipeUserConfirmed=true`（测试配方，禁止 AI 自编比例）。
4. 回执文字区分组装配制；**不**生成/发送《采购入库业务回执》PDF 冒充配制回执。
5. 不覆盖 F: 运行中采购插件；不自 Merge。

## 本地无过账

- `aierp-016m-mix-prepare-flow`：**19/19 PASS**
- 证据：`docs/poc/evidence/aierp-016m-mix-prepare-flow.json` / `.md`
- 库存：原料仓 RM-A001/B002/C003 与成品仓 FG-101 在 prepare 前后一致

## 真人企微

请用户发专用配制 Excel（FG-101 产出 1L + RM-A001/B002/C003 测试配比）→ 待确认数字草稿 → 本人回复 `确认配制{n}` → 成品仓↑ / 原料仓↓。**不要**确认旧采购 #119。

`LIVE_WECOM_CONFIRM=PENDING_USER`
