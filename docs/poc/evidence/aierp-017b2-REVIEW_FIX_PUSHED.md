# AIERP-017B2 · REVIEW_FIX_PUSHED (PR #41)

## Status

**REVIEW_FIX_PUSHED**

## Identity

| Field | Value |
|---|---|
| Branch | `feat/aierp-017b2-multi-purchase-draft` |
| Repo | `youxihe/ai-erp` only |
| Base READY HEAD | `525d428663ce602dc5429b5d6dec5f6e293b4d16` |
| Base (origin/master) | `29069d15ff6a6382f17c9925ea4d79942bd31d95` (#46) |
| Fix commit | `a0d2fde402548953400e709998764035641db1ca` |
| **Evidence/suite tip** | `5bc40da0d3d28188f75e4eb2e249d766da5ca45f` (18/18 at 2026-10-22T16:28:50.688Z) |
| **Remote HEAD** | 2ea798f531b3c1dde85b9c2125d348f051dec689 |
| Review | ChatGPT Round 1 → REVIEW_FIX_REQUIRED → **REVIEW_FIX_PUSHED** |
| Merge | **Do not merge** to master from this agent |

## Fixes

### P0 — native audit before POSTED

- `isLiveAudited` no longer returns true when CONFIRMED draft has empty `bill_number` or missing `jsh_depot_head`.
- `outcomeForConfirmedDraft` + `nativeAuditGapReason`:
  - `POSTED` only when native head exists for current tenant and `status=1`
  - else `RECONCILIATION_REQUIRED` with `MISSING_BILL` / `MISSING_NATIVE_HEAD` / `NATIVE_NOT_AUDITED`
- No new draft, no reconfirm, no `confirmPhrase` on reconciliation.

### P1 — immutable revision + scoped historical fallback

- `upsertBatch` keeps immutable `revision` on same-file reupload when manifest fingerprint unchanged; increments only on manifest change (`manifestHash`).
- Historical confirmed-bill fallback requires exact `binding_id` + `binding_version` + `wecom_user_id` (nulls never match).
- Errors selection remains explicit (`selectedBusinessKeys`); suite asserts no model `excel.confirm`.

## Changed files

1. `jshERP-boot/src/main/java/com/jsh/erp/gateway/wecom/AierpWecomExcelService.java`
2. `deploy/scripts/aierp-017b2-multi-purchase.mjs`
3. `docs/poc/evidence/aierp-017b2-multi-purchase.json`
4. `docs/poc/evidence/aierp-017b2-ready.md`
5. `docs/poc/evidence/aierp-017b2-REVIEW_FIX_PUSHED.md`

Not committed: `.tmp-app.jar`, docker build logs.

## Automated results (non-posting)

Command (worktree `D:\ERP\ai-erp-017b2`, env `deploy/.env`):

```
node deploy/scripts/aierp-017b2-multi-purchase.mjs
```

Boot: `deploy-aierp-boot:latest` rebuilt `--no-cache` from this worktree; jar verified for `RECONCILIATION_REQUIRED` / `MISSING_BILL` / `manifestHash` (no `单张采购快线`).  
At: `2026-10-22T16:28:50.688Z`

**18/18 PASS** (fail=0; stock 250.7 → 250.7)

| Case | Result |
|---|---|
| `multi_template` | PASS |
| `multi_2_drafts_3_lines` | PASS |
| `multi_exactly_two_new_drafts` | PASS |
| `multi_idempotent_same_two_drafts` | PASS |
| `idempotent_reupload_immutable_revision` | PASS |
| `purchase_batch_prepare_api` | PASS |
| `sop_purchase_batch_prepare_present` | PASS |
| `no_model_excel_confirm_tool` | PASS |
| `audited_seed_draft` | PASS |
| `audited_119_valid_posted` | PASS |
| `audited_replay_offers_pdf_and_same_bill` | PASS |
| `audited_replay_no_new_draft` | PASS |
| `prepare_verified_batch_audited` | PASS |
| `recon_missing_bill` | PASS |
| `recon_missing_native_head` | PASS |
| `recon_unapproved_native_head` | PASS |
| `conflict_bill_fields_blocked` | PASS |
| `stock_unchanged` | PASS |

Did **not** auto-post inventory or native-confirm real bills (#119 production). Suite uses synthetic `GW-PURCHASE-{draftId}` + inserted depot heads only.

## NOT_VERIFIED (human / LIVE_WECOM)

- Real WeCom multi-bill XLSX → batch summary wording
- Real WeCom re-upload of already-audited production file (e.g. #119) → 已审核 + PDF offer
- Real WeCom CONFIRMED-but-orphan native gaps → 需人工对账 (no silent POSTED)
- OpenClaw runtime on `F:\aierp-openclaw` **not** overwritten / not redeployed
- Production inventory / live confirm of audited bills **not** exercised
- Batch confirm (017C1) still not opened — per-bill `确认采购{draftId}` only

## Hard rules honored

- No Merge of PR #41
- No deploy/overwrite of `F:\aierp-openclaw`
- No auto-post inventory / no confirm of live #119 for real stock
- Prefer SOP scripts; no plugin/`index.js` rewrite for confirm
