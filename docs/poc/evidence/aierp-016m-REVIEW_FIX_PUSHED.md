# AIERP-016M REVIEW_FIX_PUSHED

**Branch:** `feat/aierp-016m-mix-sop`  
**PR:** https://github.com/youxihe/ai-erp/pull/42  
**Status:** `REVIEW_FIX_PUSHED` — no Merge; no F: OpenClaw overwrite; no MIX native post / stock write.  
**Fix commit:** `04b3fde46962e86c123ec950d689c02dbc1176fd`  
**Evidence tip (this push):** *(filled after commit)*

## Round-1 fixes (ChatGPT P0/P1)

### P0 — model boolean ≠ human approval
- Slot path: `/mix/recipe-preview` registers server-side **PROPOSED** `recipeHash` + full finished/raw display.
- `/mix/prepare` requires that **registered** `recipeHash`; `recipeUserConfirmed` / `userConfirmedRecipe` alone are rejected and never labeled「用户已确认」.
- Boolean/hash validation runs **before** Excel workflow gate so open DRAFT_READY cannot mask the 400.
- Posting remains trusted original DM「确认配制{draftId}」only (no second「确认配方」ack phrase; no `/mix/recipe-ack`).
- Invented ratios / missing hash refused; optional client finished/lines must match stored hash.

### Integration
- PURCHASE confirm + PDF paths preserved (`registerMixConfirmDispatch` only; receipt PDF still purchase-only).
- MIX vs PURCHASE/SERVICE: Gateway parses `确认耗料` and rejects cross-type via `assertConfirmKindMatchesBizType`.
- MIX PDF **not** implemented — text receipt only (`pdfStatus=NONE`).

## Evidence (non-post)

Boot rebuilt from this worktree as image `aierp-016m-boot:reviewfix`, run as `aierp-016m-boot-rf` on `127.0.0.1:9999` (shared `deploy_default` mysql/redis). No F: overwrite.

| Check | Result |
|--------|--------|
| `deploy/scripts/aierp-016m-mix-prepare.mjs` | **PASS** (ALL PASS) — JSON `docs/poc/evidence/aierp-016m-mix-prepare.json` |
| `deploy/scripts/aierp-016m-mix-prepare-flow.mjs` | **PASS** 25/25 — JSON `docs/poc/evidence/aierp-016m-mix-prepare-flow.json` |
| Negatives covered | model boolean alone; missing/unknown hash; `确认采购`/`确认耗料` on MIX; insufficient stock; stock unchanged on prepare; GW-PURCHASE-119 untouched |

## Files (fix commit)

- `jshERP-boot/.../AierpWecomMixService.java` — recipeHash preview + prepare verification
- `jshERP-boot/.../AierpWecomController.java` — `POST /mix/recipe-preview`
- `jshERP-boot/.../AierpGatewayService.java` — parse `确认耗料` for cross-type reject
- `jshERP-boot/.../LogCostFilter.java` — allow `/mix/recipe-preview`
- `deploy/openclaw/sop/mix-prepare.mjs` (+ plugin mirror)
- `deploy/openclaw/sop/registry.mjs` (+ plugin mirror)
- `deploy/openclaw/plugins/aierp-erp-tools/index.js` — thin MIX confirm only
- `deploy/openclaw/workspace/skills/erp-mixing/SKILL.md`
- `deploy/scripts/aierp-016m-mix-prepare*.mjs`

## NOT_VERIFIED

- Human WeCom MIX UAT (`确认配制{newId}` on a fresh draft)
- F: shared OpenClaw plugin deploy
- MIX dedicated PDF (intentionally none)

## Hard rules honored

- No Merge
- No F: overwrite
- No automatic native stock write / no real MIX post
