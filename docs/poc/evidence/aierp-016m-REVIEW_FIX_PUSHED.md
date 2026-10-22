# AIERP-016M REVIEW_FIX_PUSHED

**Branch:** `feat/aierp-016m-mix-sop`  
**PR:** https://github.com/youxihe/ai-erp/pull/42  
**Status:** `REVIEW_FIX_PUSHED` — no Merge; no F: OpenClaw overwrite; no MIX native post / stock write.  
**HEAD:** _(pinned after push tip)_

## Round-1 fixes (ChatGPT P0/P1)

### P0 — model boolean ≠ human approval
- Slot path: `/mix/recipe-preview` registers server-side **PROPOSED** `recipeHash` + full finished/raw display.
- `/mix/prepare` requires that **registered** `recipeHash`; `recipeUserConfirmed` / `userConfirmedRecipe` alone are rejected and never labeled「用户已确认」.
- **Order fix:** `buildMixBodyFromSlots` (hash/boolean gate) runs **before** `assertNoBlockingWorkflow`, so an open Excel `DRAFT_READY` cannot mask the 400「布尔不能证明用户已核对」response with 409「待确认草稿」.
- Posting remains trusted original DM「确认配制{draftId}」only (no second「确认配方」ack phrase; no `/mix/recipe-ack`).
- Invented ratios / missing hash refused; optional client finished/lines must match stored hash.
- Plugin `buildMixPrepareBody` mirrors Java: boolean without hash throws; hash required.
- Evidence script probes boolean reject both while Excel draft is open and after cancel.

### Integration
- PURCHASE confirm + PDF paths preserved (`purchase_confirm` in registry; `runReceiptSend` / `CONFIRM_PURCHASE` intact in plugin).
- MIX vs PURCHASE/SERVICE: Gateway parses `确认耗料` and rejects cross-type via `assertConfirmKindMatchesBiz`.
- MIX PDF **not** implemented — text receipt only (`pdfStatus=NONE`).
- `Dockerfile.boot` / maven-central settings **not** committed (local build convenience only).

## Evidence (non-post)

| Check | Result |
|--------|--------|
| `node --check` plugin `index.js`, `mix-prepare.mjs`, both evidence scripts | **PASS** |
| Local phrase/SOP unit (确认配制 / 确认配方≠post / boolean without hash / purchase route) | **PASS** 5/5 |
| `deploy/scripts/aierp-016m-mix-prepare.mjs` against live boot | **PARTIAL** — earlier run on **pre-reorder** image: 18 PASS / 1 FAIL (`refuse_model_boolean_as_recipe_approval` got 409「待确认草稿#206」because workflow gate ran first). Stock unchanged; GW-PURCHASE-119 untouched. |
| Re-run after this reorder commit | **BLOCKED_NEED_BOOT** — Docker Desktop engine pipe missing; boot timeout on `127.0.0.1:9999` |
| `deploy/scripts/aierp-016m-mix-prepare-flow.mjs` | **BLOCKED_NEED_BOOT** (same) |

Prefer after Docker recovers: rebuild boot from **this** worktree (`deploy/docker-compose.yml` build `aierp-boot`); do **not** overwrite F: runtime; do **not** auto「确认配制」.

## NOT_VERIFIED

- Human WeCom MIX UAT (`确认配制{newId}` on a fresh draft)
- Full non-post script PASS against boot rebuilt with this reorder
- F: shared OpenClaw plugin deploy
- MIX dedicated PDF (intentionally none)

## Hard rules honored

- No Merge
- No F: overwrite
- No automatic native stock write / no real MIX post
