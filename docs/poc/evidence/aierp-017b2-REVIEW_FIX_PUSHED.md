# AIERP-017B2 · REVIEW_FIX_PUSHED (PR #41)

## Identity

| Field | Value |
|---|---|
| Branch | `feat/aierp-017b2-multi-purchase-draft` |
| Base READY HEAD | `525d428663ce602dc5429b5d6dec5f6e293b4d16` |
| Review | ChatGPT Round 1 → **REVIEW_FIX_REQUIRED** |
| This note | **REVIEW_FIX_PUSHED** |
| Merge | **Do not merge** to master from this agent |

> Post-fix HEAD: `a0d2fde402548953400e709998764035641db1ca`

## Fixes

### P0 — `isLiveAudited` / confirmed native verification

- CONFIRMED gateway draft **no longer** claims 已审核/已入库 when `bill_number` is missing or `jsh_depot_head` is missing / not `status=1`.
- New path: `outcomeForConfirmedDraft` + `nativeAuditGapReason` → `POSTED` only when native head is audited for current tenant; else `RECONCILIATION_REQUIRED` (`MISSING_BILL` / `MISSING_NATIVE_HEAD` / `NATIVE_NOT_AUDITED`).
- No new draft, no reconfirm, no `confirmPhrase` on reconciliation rows.
- Workflow / summaries use 需人工对账; never strip pending wording into 已审核 for reconciliation gaps.

### P1 — batch revision + historical fallback

- `upsertBatch` keeps **immutable revision** on same-file/hash reupload when draft manifest fingerprint unchanged; increments only when manifest changes (`manifestHash`).
- Historical confirmed-bill fallback scoped to **exact** `binding_id` + `binding_version` + `wecom_user_id` (nulls never match).
- Errors still require explicit `selectedBusinessKeys`; no model `excel.confirm` tool (asserted in suite).

DDL: `aierp_excel_batch` already in `deploy/sql/04-aierp-excel.sql` — **no migration**.

## Changed files

1. `jshERP-boot/src/main/java/com/jsh/erp/gateway/wecom/AierpWecomExcelService.java`
2. `deploy/scripts/aierp-017b2-multi-purchase.mjs`
3. `docs/poc/evidence/aierp-017b2-multi-purchase.json`
4. `docs/poc/evidence/aierp-017b2-ready.md`
5. `docs/poc/evidence/aierp-017b2-REVIEW_FIX_PUSHED.md` (this file)

## Automated results (local non-posting)

Command: `node deploy/scripts/aierp-017b2-multi-purchase.mjs`  
Boot image: `deploy-aierp-boot:017b2-review-fix` (contains `MISSING_BILL` / `RECONCILIATION_REQUIRED` / `manifestHash`)  
At: `2026-10-22T16:08:46.504Z`

**18/18 PASS** (stock unchanged 250.7 → 250.7)

| Case | Result |
|---|---|
| multi 2 drafts / 3 lines + idempotent | PASS |
| idempotent reupload immutable revision | PASS (`rev` 1→1) |
| purchase-batch-prepare API + SOP present | PASS |
| no model `excel.confirm` | PASS |
| #119-style valid posted (native head `status=1`) | PASS |
| missing `bill_number` → `RECONCILIATION_REQUIRED` / `MISSING_BILL` | PASS |
| missing native head → `MISSING_NATIVE_HEAD` | PASS |
| unapproved head → `NATIVE_NOT_AUDITED` | PASS |
| conflicting bill fields blocked | PASS |
| stock unchanged | PASS |

Did **not** re-confirm or post inventory for `GW-PURCHASE-119` or any live audited bill. Suite uses synthetic `GW-PURCHASE-{draftId}` + inserted depot heads only.

## LIVE_WECOM = NOT_VERIFIED

- Real WeCom multi-bill XLSX upload → batch summary wording
- Real WeCom re-upload of already-audited production file (e.g. #119) → 已审核 + PDF offer (no 待确认/未入库)
- Real WeCom path for CONFIRMED-but-orphan native gaps → 需人工对账 (no silent POSTED)
- OpenClaw runtime on `F:\aierp-openclaw` **not** overwritten / not redeployed by this agent
- Production inventory / live confirm of audited bills **not** exercised

## Remote HEAD

```
a0d2fde402548953400e709998764035641db1ca
```

Branch tip after push: `origin/feat/aierp-017b2-multi-purchase-draft` @ above sha.
