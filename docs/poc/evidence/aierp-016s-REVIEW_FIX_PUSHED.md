# AIERP-016S REVIEW_FIX_PUSHED

**Branch:** `feat/aierp-016s-service-outbound-sop`  
**PR:** https://github.com/youxihe/ai-erp/pull/43  
**Status:** `REVIEW_FIX_PUSHED` 鈥?no Merge; no F: plugin overwrite; no re-post of `GW-SERVICE-136`.  
**HEAD:** `aecfdddc9778e4abd8943cba8427043daa958304`
**Code fix:** `48fecfef`

## Round-1 fixes

### P0
- Trusted phrases: PURCHASE / MIX / SERVICE cross-type mismatch rejected (`assertConfirmKindMatchesBiz`; plugin routes `纭閰嶅埗` into trusted confirm path so Java rejects on SERVICE).
- 015C PDF media path preserved: `receipt-send.mjs` + registry `canHandleReceipt` still first; SERVICE only adds text-receipt workflow labels (`宸插嚭搴揱), does not retitle purchase PDF.
- F: shared OpenClaw runtime not overwritten from this branch.

### P1
- Customer visibility: `assertCustomerVisible` via `UserCustomer` when `customerFlag=1` (prepare `resolveOrgan`, confirm `reassertParties`, Excel SERVICE preview) 鈥?not tenant-only.
- Depot: `assertDepotAllowed` / `reassertAccess` re-check `UserDepot` at prepare and native posting (empty assignment denies).
- No AR/sales posting: `assertGatewayBizType` rejects `SALE`/`SALES`/`AR`.
- Audited replay: CONFIRMED same `idempotencyKey` short-circuits **before** `normalize` (ignores live stock drift); same XLSX `prepare-verified` on POSTED returns posted bill, never a new DRAFT.

## Files

| Path | Role |
|---|---|
| `jshERP-boot/.../AierpGatewayService.java` | UserCustomer + depot recheck; CONFIRMED idempotent replay; cross-type phrase |
| `jshERP-boot/.../excel/AierpExcelService.java` | SERVICE preview UserCustomer (not tenant-only) |
| `jshERP-boot/.../AierpWecomServiceConsumeService.java` | POSTED / same-file prepare-verified 鈫?posted bill |
| `jshERP-boot/.../AierpWecomExcelService.java` | SERVICE posted summary; preserve PURCHASE PDF path |
| `jshERP-boot/.../AierpWecomConfirmService.java` | markWorkflowPosted(bizType) |
| `jshERP-boot/.../filter/LogCostFilter.java` | HMAC allowlist includes `service/prepare` (+ verified) |
| `deploy/openclaw/plugins/aierp-erp-tools/index.js` | trusted `纭閰嶅埗` phrase |
| `deploy/scripts/aierp-016s-service-consume.mjs` | non-post REVIEW_FIX suite |

## Evidence (non-post) 鈥?ALL PASS

- Command: `AIERP_016S_CONFIRM` **unset** (prepare + negatives only; no stock write).
- Script: `deploy/scripts/aierp-016s-service-consume.mjs`
- JSON: `docs/poc/evidence/aierp-016s-service-consume.json` (`pass: true`, `doConfirm: false`)
- Negatives: bad customer, UserCustomer invisible (`customerFlag=1` 鈫?鑻忓窞绮惧瘑鐢靛瓙 403), cross-depot 403, cross-owner confirm, `纭閲囪喘`/`纭閰嶅埗` on SERVICE, `纭鑰楁枡` on PURCHASE, no native bill after prepare.
- Audited replay fixture `GW-SERVICE-136` 鈫?`CONFIRMED` / `posted=true` / stock unchanged (no second outbound).
- XLSX POSTED `prepare-verified` 鈫?same draft #136, `replayed=true`, not new DRAFT.
- Fresh prepare draft cancelled unposted (latest run `#226`).

## NOT_VERIFIED

- Human WeCom UAT (`纭鑰楁枡{newId}` on a fresh draft)
- F: shared OpenClaw plugin deploy
- SERVICE dedicated PDF template (text receipt only; `pdfStatus=NONE`)

## Hard rules honored

- No Merge
- No F: overwrite
- No re-post / auto stock write of `GW-SERVICE-136`
