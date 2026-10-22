# AIERP-016S REVIEW_FIX_PUSHED

**Branch:** `feat/aierp-016s-service-outbound-sop`  
**PR:** https://github.com/youxihe/ai-erp/pull/43  
**Status:** `REVIEW_FIX_PUSHED` — no Merge; no F: plugin overwrite; no re-post of `GW-SERVICE-136`.  
**HEAD:** `2d3b89f4d7d9b6e0430814227f8c06cbeed9124d`  
**Code fix:** `48fecfef` (UserCustomer / depot / cross-type / audited replay).

## Round-1 fixes

### P0
- Trusted phrases: PURCHASE / MIX / SERVICE cross-type mismatch rejected (`assertConfirmKindMatchesBiz`; plugin accepts `确认配制` into trusted confirm path so Java can reject on SERVICE).
- 015C PDF media path preserved: `receipt-send.mjs` + registry `canHandleReceipt` still first; SERVICE only adds text-receipt workflow labels (`已出库`), does not retitle purchase PDF; PURCHASE confirm still auto-sends receipt PDF via `runReceiptSend`.
- F: shared OpenClaw runtime not overwritten from this branch.

### P1
- Customer visibility: `assertCustomerVisible` via `UserCustomer` when `customerFlag=1` (prepare `resolveOrgan`, confirm `reassertParties`, Excel SERVICE preview) — not tenant-only.
- Depot: `assertDepotAllowed` / `reassertAccess` re-check `UserDepot` at prepare and native posting (empty assignment denies).
- No AR/sales posting: gateway rejects `SALE`/`SALES`/`AR`.
- Audited replay: CONFIRMED same `idempotencyKey` returns posted bill (ignores live stock-snapshot drift); same XLSX `prepare-verified` on POSTED workflow returns posted bill, never a new DRAFT.

## Evidence (non-post) — ALL PASS

- Command: `AIERP_016S_CONFIRM` unset; `AIERP_MYSQL_TCP=1` (host `127.0.0.1:13306` when Docker CLI pipe flaky).
- Script: `deploy/scripts/aierp-016s-service-consume.mjs`
- JSON: `docs/poc/evidence/aierp-016s-service-consume.json` (`pass: true`, `doConfirm: false`)
- Negatives: bad customer, UserCustomer invisible (flag=1 → 苏州精密电子 403), cross-depot 403, cross-owner confirm, `确认采购`/`确认配制` on SERVICE, `确认耗料` on PURCHASE, no native bill after prepare.
- Audited replay fixture `GW-SERVICE-136` → `CONFIRMED` / `posted=true` / stock unchanged; XLSX POSTED replay → same draft, not new DRAFT.
- Fresh prepare draft `#209` cancelled unposted (no stock write).

## NOT_VERIFIED

- Human WeCom UAT (`确认耗料{newId}` on a fresh draft)
- F: shared OpenClaw plugin deploy
- SERVICE dedicated PDF template (text receipt only; `pdfStatus=NONE`)

## Hard rules honored

- No Merge
- No F: overwrite
- No re-post / auto stock write of `GW-SERVICE-136`
