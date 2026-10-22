# AIERP-016S REVIEW_FIX_PUSHED

**Branch:** `feat/aierp-016s-service-outbound-sop`  
**PR:** https://github.com/youxihe/ai-erp/pull/43  
**Status:** `REVIEW_FIX_PUSHED` — no Merge; no F: plugin overwrite; no re-post of `GW-SERVICE-136`.  
**HEAD:** _(filled after push)_

## Round-1 fixes

### P0
- Trusted phrases: PURCHASE / MIX / SERVICE cross-type mismatch rejected (`assertConfirmKindMatchesBiz`; plugin accepts `确认配制` into trusted confirm path so Java can reject on SERVICE).
- 015C PDF media path preserved: receipt registry `canHandleReceipt` still first; SERVICE only adds text-receipt workflow labels (`已出库`), does not retitle purchase PDF; PURCHASE confirm still auto-sends receipt PDF via `runReceiptSend`.
- F: shared OpenClaw runtime not overwritten from this branch.

### P1
- Customer visibility: `assertCustomerVisible` via `UserCustomer` when `customerFlag=1` (prepare `resolveOrgan`, confirm `reassertParties`, Excel SERVICE preview) — not tenant-only.
- Depot: `assertDepotAllowed` / `reassertAccess` re-check `UserDepot` at prepare and native posting (empty assignment denies).
- No AR/sales posting: gateway `assertGatewayBizType` rejects `SALE`/`SALES`/`AR`.
- Audited replay: CONFIRMED same `idempotencyKey` returns posted bill (ignores live stock-snapshot drift); same XLSX `prepare-verified` on POSTED workflow returns posted bill, never a new DRAFT.

## Evidence (non-post)

- Script: `deploy/scripts/aierp-016s-service-consume.mjs` with **`AIERP_016S_CONFIRM` unset** (prepare + negatives only; do not set confirm for GW-SERVICE-136).
- JSON: `docs/poc/evidence/aierp-016s-service-consume.json` (when script last run locally).
- Negatives covered in script: bad customer, UserCustomer invisible (flag=1), cross-depot, cross-owner confirm, `确认采购` / `确认配制` on SERVICE, `确认耗料` on PURCHASE, no native bill after prepare.
- Audited replay of fixture `GW-SERVICE-136` → CONFIRMED / posted / stock unchanged (no second outbound); XLSX prepare-verified on POSTED → same draft, `posted=true`, `autoDraft≠true`.

## NOT_VERIFIED

- Human WeCom UAT (`确认耗料{newId}` on a fresh draft)
- F: shared OpenClaw plugin deploy
- SERVICE dedicated PDF template (text receipt only; `pdfStatus=NONE`)

## Hard rules honored

- No Merge
- No F: overwrite
- No re-post / auto stock write of `GW-SERVICE-136`
