# AIERP-016S PRECHECK_INDEPENDENT (Round 2)

**Branch:** `feat/aierp-016s-service-outbound-sop`  
**PR:** https://github.com/youxihe/ai-erp/pull/43  
**Status:** independent pre-integration PASS — **no Merge**, **no F:** overwrite, **no** re-post of `GW-SERVICE-136`.  
**Code tip (pre-docs):** `cffe97e1` · review fix `48fecfef`  
**Blocked on:** PR #42 (`feat/aierp-016m-mix-sop`) merge → then `INTEGRATION_FIX` on shared files.

## Boot under test

- Hot-reload from `D:\ERP\ai-erp-016s` → `deploy/runtime/app.jar` bind-mounted on `aierp-boot:9999`
- Jar built from this branch (`jshERP-boot/target/jshERP.jar`, includes `assertCustomerVisible` / cross-type / CONFIRMED idempotent replay)
- Suite: `AIERP_016S_CONFIRM` **unset** → prepare + negatives only

## Code review (static) — Round-1 REVIEW_FIX still holds

| Check | Verdict | Where |
|---|---|---|
| UserCustomer visibility | OK | `assertCustomerVisible` when `customerFlag=1`; Excel SERVICE preview + prepare `resolveOrgan` + confirm `reassert` |
| Depot recheck | OK | `assertDepotAllowed` / `reassertAccess` / `checkStoredLine` — empty UserDepot denies |
| Cross-type confirms | OK | `assertConfirmKindMatchesBiz` — 确认采购/确认配制 on SERVICE and 确认耗料 on PURCHASE rejected |
| Audited XLSX replay | OK | CONFIRMED lookup **before** normalize; POSTED same-file → `replayed=true`, no second DRAFT |
| No SALE / AR | OK | `assertGatewayBizType` rejects `SALE`/`SALES`/`AR`; SERVICE posts 出库/其它 only |

## Independent non-post suite — ALL PASS

Command: `node deploy/scripts/aierp-016s-service-consume.mjs` (confirm unset)

| Case | Result |
|---|---|
| `reject_usercustomer_invisible` (苏州精密电子) | 403 PASS |
| `reject_cross_depot` | 403 PASS |
| `reject_purchase_phrase_on_service` / `reject_mix_phrase_on_service` | 400 PASS |
| `reject_service_phrase_on_purchase` | 400 PASS |
| `prepare_stock_unchanged` / `no_post_after_prepare` | PASS (draft #246 cancelled) |
| `audited_replay_posted_not_new_draft` GW-SERVICE-136 | CONFIRMED / stock unchanged 149 |
| `xlsx_posted_replay_no_new_draft` | draft #136 `replayed=true` |
| JSON evidence | `docs/poc/evidence/aierp-016s-service-consume.json` (`pass: true`, `doConfirm: false`) |

## Predicted conflict files (gaps vs master after #41)

Content conflicts `origin/master...HEAD` (merge-tree “changed in both”):

1. `deploy/openclaw/plugins/aierp-erp-tools/sop/registry.mjs`
2. `deploy/openclaw/sop/registry.mjs`
3. `docs/poc/QUEUE.md`
4. `jshERP-boot/.../filter/LogCostFilter.java`
5. `jshERP-boot/.../gateway/AierpGatewayService.java`
6. `jshERP-boot/.../gateway/excel/AierpExcelService.java`
7. `jshERP-boot/.../gateway/wecom/AierpWecomController.java`
8. `jshERP-boot/.../gateway/wecom/AierpWecomExcelService.java`

## Shared with open PR #42 (016M) — INTEGRATION_FIX after #42 merges

Also both change (will conflict when rebasing/merging #43 onto post-#42 master):

- `deploy/openclaw/plugins/aierp-erp-tools/index.js`
- `jshERP-boot/.../AierpWecomConfirmService.java`
- `jshERP-boot/.../AierpWecomReceiptService.java`
- (+ the registry / Gateway / Excel / Controller / LogCostFilter set above)

016S-only (low conflict risk): `AierpWecomServiceConsumeService.java`, `service-consume.mjs` SOP/plugin/skill, consume script + 016S evidence.

## Ready-for-integration checklist (post-#42)

- [ ] #42 merged to master; rebase/merge #43 onto new master
- [ ] Resolve shared files preserving: 015C PDF/`receipt-send` priority, MIX `确认配制`, SERVICE `确认耗料` + UserCustomer/depot/cross-type/replay
- [ ] Hot-reload jar from integrated tip; re-run non-post suite (still no GW-SERVICE-136 re-post)
- [ ] Optional: one controlled `AIERP_016S_CONFIRM=1` on a **fresh** draft only (never #136)
- [ ] Human WeCom UAT; F: plugin deploy only in final integration window
- [ ] Do **not** Merge #43 while `mergeable_state=dirty` vs current master

## Hard rules honored this round

- No Merge · No F: · No auto stock post · No GW-SERVICE-136 re-post
