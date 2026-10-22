# AIERP-016S REVIEW_FIX_PUSHED

**Branch:** `feat/aierp-016s-service-outbound-sop`  
**PR:** https://github.com/youxihe/ai-erp/pull/43  
**Status:** `REVIEW_FIX_PUSHED` — no Merge; no F: plugin overwrite; no re-post of `GW-SERVICE-136`.  
**HEAD:** `e4ae301f5eac3cc630d77557c3e999b8531d280f`  
**Code fix:** `48fecfef`

## Round-1 fixes

### P0
- Trusted phrases: PURCHASE / MIX / SERVICE cross-type mismatch rejected (`assertConfirmKindMatchesBiz`; plugin routes `确认配制` into trusted confirm path so Java rejects on SERVICE).
- 015C PDF media path preserved: `receipt-send.mjs` + registry `canHandleReceipt` still first; SERVICE only adds text-receipt workflow labels (`已出库`), does not retitle purchase PDF.
- F: shared OpenClaw runtime not overwritten from this branch.

### P1
- Customer visibility: `assertCustomerVisible` via `UserCustomer` when `customerFlag=1` (prepare `resolveOrgan`, confirm `reassertParties`, Excel SERVICE preview) — not tenant-only.
- Depot: `assertDepotAllowed` / `reassertAccess` re-check `UserDepot` at prepare and native posting (empty assignment denies).
- No AR/sales posting: `assertGatewayBizType` rejects `SALE`/`SALES`/`AR`.
- Audited replay: CONFIRMED same `idempotencyKey` short-circuits **before** `normalize` (ignores live stock drift); same XLSX `prepare-verified` on POSTED returns posted bill, never a new DRAFT.

## Files

| Path | Role |
|---|---|
| `jshERP-boot/.../AierpGatewayService.java` | UserCustomer + depot recheck; CONFIRMED idempotent replay; cross-type phrase |
| `jshERP-boot/.../excel/AierpExcelService.java` | SERVICE preview UserCustomer (not tenant-only) |
| `jshERP-boot/.../AierpWecomServiceConsumeService.java` | POSTED / same-file prepare-verified → posted bill |
| `jshERP-boot/.../AierpWecomExcelService.java` | SERVICE posted summary; preserve PURCHASE PDF path |
| `jshERP-boot/.../AierpWecomConfirmService.java` | markWorkflowPosted(bizType) |
| `jshERP-boot/.../filter/LogCostFilter.java` | HMAC allowlist includes `service/prepare` (+ verified) |
| `deploy/openclaw/plugins/aierp-erp-tools/index.js` | trusted `确认配制` phrase |
| `deploy/scripts/aierp-016s-service-consume.mjs` | non-post REVIEW_FIX suite |

## Evidence (non-post) — ALL PASS

- Command: `AIERP_016S_CONFIRM` **unset** (prepare + negatives only; no stock write).
- Script: `deploy/scripts/aierp-016s-service-consume.mjs`
- JSON: `docs/poc/evidence/aierp-016s-service-consume.json` (`pass: true`, `doConfirm: false`)
- Negatives: bad customer, UserCustomer invisible (`customerFlag=1` → 苏州精密电子 403), cross-depot 403, cross-owner confirm, `确认采购`/`确认配制` on SERVICE, `确认耗料` on PURCHASE, no native bill after prepare.
- Audited replay fixture `GW-SERVICE-136` → `CONFIRMED` / `posted=true` / stock unchanged (no second outbound).
- XLSX POSTED `prepare-verified` → same draft #136, `replayed=true`, not new DRAFT.
- Fresh prepare draft cancelled unposted (latest run `#226`).

## NOT_VERIFIED

- Human WeCom UAT (`确认耗料{newId}` on a fresh draft)
- F: shared OpenClaw plugin deploy
- SERVICE dedicated PDF template (text receipt only; `pdfStatus=NONE`)

## Hard rules honored

- No Merge
- No F: overwrite
- No re-post / auto stock write of `GW-SERVICE-136`
