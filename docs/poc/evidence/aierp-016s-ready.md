# AIERP-016S READY_FOR_REVIEW

## Scope
客户服务耗料出库（SERVICE = 原生其它出库，≠ 销售出库/开票/应收）。

## Delivered
- Java `AierpWecomServiceConsumeService`：`servicePrepare`（对话槽位）+ `prepareVerifiedService`（Excel 预览）
- HMAC API：`POST /aierp/v1/wecom/service/prepare`、`/service/prepare-verified`
- Gateway：`确认耗料{draftId}` challenge / kind 校验；库存不足拒绝建草稿
- 回执标题《服务耗料出库回执》；无独立 SERVICE PDF 时仅文字（`pdfStatus=NONE`），不复用采购 PDF 改标题
- SOP：`sop/service-consume.mjs` + registry `service_confirm`（**未改** `plugin/index.js`，无 F: 部署）

## Automated evidence
`node deploy/scripts/aierp-016s-service-consume.mjs` with `AIERP_016S_CONFIRM=1`:

| Check | Result |
|---|---|
| Real customer `苏州精密电子` | PASS |
| Prepare FG-101 成品仓 1L → DRAFT，库存 151 不变 | PASS `#133` / `确认耗料133` |
| Reject bad customer / insufficient stock | PASS |
| Reject `确认采购` on SERVICE draft | PASS |
| Confirm → `GW-SERVICE-133` 出库/其它 已审核 | PASS |
| FG-101 成品仓 151→150；原料仓 250.7 不变 | PASS |
| Replay confirm no double outbound | PASS |
| Receipt text 《服务耗料出库回执》；`pdfStatus=NONE` | PASS |

JSON: `docs/poc/evidence/aierp-016s-service-consume.json`

## UAT（真人企微，统一 F: 集成后）
1. 服务耗料模板 / `erp_service_prepare`（集成后）→ 待确认，库存不变
2. 本人私聊 `确认耗料{数字draftId}` → 成品仓 −1L、原料仓不变、文字回执
3. `LIVE_WECOM_CHANNEL=PENDING` until F: wires SOP registry without concurrent overwrite

Cursor: no Merge; no F: deploy.
