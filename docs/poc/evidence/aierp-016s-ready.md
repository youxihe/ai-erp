# AIERP-016S · READY_FOR_REVIEW

**Branch:** `feat/aierp-016s-service-outbound-sop`  
**Base:** `origin/master` `74b32fe8`  
**Status:** READY_FOR_REVIEW（Cursor 不 Merge；未覆盖 F: 插件）

## Delivered

| Item | Location |
|---|---|
| Java prepare | `AierpWecomServiceConsumeService`：`servicePrepare` + `prepareVerifiedService` |
| API | `POST /aierp/v1/wecom/service/prepare`、`/service/prepare-verified`（HMAC allowlist） |
| Confirm | 可信私聊原文 `确认耗料{draftId}` → `/draft/confirm`；`确认采购` 拒 SERVICE；无 LLM confirm 工具 |
| Native bill | `出库/其它` → `GW-SERVICE-{id}`（非 SALE / 财务） |
| SOP | `deploy/openclaw/.../sop/service-consume.mjs` + registry `service_confirm` |
| Plugin（源码树） | `erp_service_prepare` + `确认耗料` before_dispatch；勿直接覆盖 F: |
| Receipt | 文字《服务耗料出库回执》；`pdfStatus=NONE`（专用 SERVICE PDF 未交付，诚实标注） |

## Evidence

- `docs/poc/evidence/aierp-016s-service-consume.md`
- `docs/poc/evidence/aierp-016s-service-consume.json`

样例：`GW-SERVICE-136`，FG-101 成品仓 150→149，原料仓不变，重放不二次出库。

## Human WeCom UAT

- [ ] 私聊新草稿 + `确认耗料{n}`（勿用已审 #136）
- [ ] 确认前库存不变；确认后成品仓 −1 L
- [ ] 收到文字《服务耗料出库回执》（PDF N/A）
