# AIERP-016M REVIEW_FIX_PUSHED

**Branch:** `feat/aierp-016m-mix-sop`  
**PR:** https://github.com/youxihe/ai-erp/pull/42  
**Status:** `REVIEW_FIX_PUSHED` — no Merge; no F: OpenClaw overwrite; no MIX native post / stock write.  
**Suite evidence tip:** `3cd888d3539280ba546bb8043716e64583ac219e` (20/20 + 25/25 non-post)  
**Evidence at:** 2026-10-23 ~01:05 +08:00 (this agent run; REVIEW_FIX_PUSHED tip = this commit after push)

## Round-1 fixes (ChatGPT P0)

### P0 — model boolean ≠ human approval
- Slot path: `/mix/recipe-preview` registers server-side **PROPOSED** `recipeHash` + full finished/raw display (FG qty/unit/depot + raw lines).
- `/mix/prepare` requires that **registered** `recipeHash`; `recipeUserConfirmed` / `userConfirmedRecipe` alone are rejected and never labeled「用户已确认」.
- Boolean / hash validation runs **before** Excel workflow 409 so open `DRAFT_READY` cannot mask the boolean refusal.
- Draft shown to user carries `recipeHash` digest; posting remains trusted original DM「确认配制{draftId}」only (no model-boolean confirm; Mix PDF not implemented).
- Invented ratios / missing / unknown hash refused; optional client finished/lines must match stored hash.
- Plugin `buildMixPrepareBody` mirrors Java: boolean without hash throws; hash required.

### Integration
- PURCHASE confirm + PDF paths preserved (registry `purchase_confirm`; receipt PDF still purchase-only).
- MIX vs PURCHASE/SERVICE: Gateway parses「确认耗料」; cross-type confirm of wrong draft rejected.
- MIX PDF **not** implemented — accurate text receipt only.
- After #41 merges: still need integration rebase onto master for overlapping plugin/Confirm/Excel/Gateway (parallel fix on this tip is intentional).

## Changed files (feature commits already on branch)

- `jshERP-boot/.../AierpWecomMixService.java` — recipe-preview + hash-gated prepare; boolean gate before workflow
- `jshERP-boot/.../AierpWecomController.java` — `/mix/recipe-preview`, `/mix/prepare`
- `jshERP-boot/.../AierpGatewayService.java` —「确认耗料」parse + cross-type assert
- `jshERP-boot/.../LogCostFilter.java` — allowlist recipe-preview
- `deploy/openclaw/**/mix-prepare.mjs`, `registry.mjs`, `index.js`, `erp-mixing/SKILL.md`
- `deploy/scripts/aierp-016m-mix-prepare*.mjs`
- `deploy/Dockerfile.boot` + `deploy/scripts/maven-central-settings.xml`

## Evidence (non-post) — this run

| Check | Result |
|--------|--------|
| `node deploy/scripts/aierp-016m-mix-prepare.mjs` | **20/20 PASS** (incl. `refuse_model_boolean_while_excel_draft_open`, `refuse_model_boolean_as_recipe_approval`, cross-type reject; stock unchanged; GW-PURCHASE-119 untouched) |
| `node deploy/scripts/aierp-016m-mix-prepare-flow.mjs` | **25/25 PASS** (slot preview→hash prepare; reject 确认采购/确认耗料 on MIX; stock unchanged) |
| Boot | local `aierp-016m-boot-rf` / `aierp-016m-boot:reviewfix` rebuilt from this worktree (no F: overwrite) |

JSON/MD: `docs/poc/evidence/aierp-016m-mix-prepare*.json|md`

## NOT_VERIFIED / LIVE_WECOM=NOT_VERIFIED

- Human WeCom MIX UAT (`确认配制{newId}` on a fresh draft → FG-101 +1L / raw deltas)
- Live WeCom channel end-to-end (adapter → before_dispatch → text receipt)
- Native MIX PDF (intentionally not implemented)
- Integration rebase after #41 merges onto master
- F: shared OpenClaw plugin deploy (not overwritten)

## Hard rules honored

- No Merge
- No F: overwrite
- No automatic native stock write / no real MIX post
