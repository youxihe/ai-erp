# AIERP-016M REVIEW_FIX_PUSHED

**Branch:** `feat/aierp-016m-mix-sop`  
**PR:** https://github.com/youxihe/ai-erp/pull/42  
**Status:** `REVIEW_FIX_PUSHED` — no Merge; no F: OpenClaw overwrite; no MIX native post / stock write.  
**HEAD:** `04b3fde46962e86c123ec950d689c02dbc1176fd`

## Round-1 fixes (ChatGPT P0/P1)

### P0 — model boolean ≠ human approval
- Slot path: `/mix/recipe-preview` registers server-side **PROPOSED** `recipeHash` + full finished/raw display.
- `/mix/prepare` requires that **registered** `recipeHash`; `recipeUserConfirmed` / `userConfirmedRecipe` alone are rejected and never labeled「用户已确认」.
- Posting remains trusted original DM「确认配制{draftId}」only (no second「确认配方」ack phrase; no `/mix/recipe-ack`).
- Invented ratios / missing hash refused; optional client finished/lines must match stored hash.
- Plugin `buildMixPrepareBody` mirrors Java: boolean without hash throws; hash required.

### Integration
- PURCHASE confirm + PDF paths preserved (`registerMixConfirmDispatch` only; receipt PDF still purchase-only via `canHandleReceipt` / `runReceiptSend`).
- MIX vs PURCHASE/SERVICE: Gateway parses `确认耗料` and rejects cross-type via `assertConfirmKindMatchesBiz`.
- MIX PDF **not** implemented — text receipt only (`pdfStatus=NONE` honesty in SOP formatters).
- `Dockerfile.boot` / maven-central settings **not** committed (local build convenience only).

## Evidence (non-post)

| Check | Result |
|--------|--------|
| `node --check` on plugin `index.js`, `mix-prepare.mjs`, `registry.mjs`, both evidence scripts | **PASS** |
| Local phrase/SOP unit (confirm配制 / reject 确认配方 as post / reject boolean without hash / hash len / purchase route) | **PASS** 8/8 |
| `deploy/scripts/aierp-016m-mix-prepare.mjs` | **BLOCKED_NEED_BOOT** — Docker Desktop engine down (`com.docker.service` Stopped); boot unreachable on `127.0.0.1:9999` |
| `deploy/scripts/aierp-016m-mix-prepare-flow.mjs` | **BLOCKED_NEED_BOOT** (same) |
| `mvn compile` | **SKIPPED** — `mvn`/`java` not on PATH in this agent environment |

Prefer after Docker recovers: rebuild boot from **this** worktree with isolated compose project name (e.g. `-p aierp016mrf`) if port 9999 contested; do **not** overwrite F: runtime.

## NOT_VERIFIED

- Human WeCom MIX UAT (`确认配制{newId}` on a fresh draft)
- Live non-post script PASS against rebuilt boot
- F: shared OpenClaw plugin deploy
- MIX dedicated PDF (intentionally none)

## Hard rules honored

- No Merge
- No F: overwrite
- No automatic native stock write / no real MIX post
