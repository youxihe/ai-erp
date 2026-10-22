# AIERP-016M REVIEW_FIX_PUSHED

**Branch:** `feat/aierp-016m-mix-sop`  
**PR:** https://github.com/youxihe/ai-erp/pull/42  
**Status:** `REVIEW_FIX_PUSHED` 閳?no Merge; no F: OpenClaw overwrite; no MIX native post / stock write.  
**HEAD:** `14ac134368a2121d530abf72b80a2a1b8420b52a`
**Evidence at:** 2026-10-23 00:56 +08:00

## Round-1 fixes (ChatGPT P0)

### P0 閳?model boolean 閳?human approval
- Slot path: `/mix/recipe-preview` registers server-side **PROPOSED** `recipeHash` + full finished/raw display.
- `/mix/prepare` requires that **registered** `recipeHash`; `recipeUserConfirmed` / `userConfirmedRecipe` alone are rejected and never labeled閵嗗瞼鏁ら幋宄板嚒绾喛顓婚妴?
- Boolean gate runs **before** Excel workflow 409 so open `DRAFT_READY` cannot mask the boolean refusal.
- Posting remains trusted original DM閵嗗瞼鈥樼拋銈夊帳閸掔БdraftId}閵嗗朝nly (no second inventory confirm phrase).
- Invented ratios / missing / unknown hash refused; optional client finished/lines must match stored hash.
- Plugin `buildMixPrepareBody` mirrors Java: boolean without hash throws; hash required.

### Integration
- PURCHASE confirm + PDF paths preserved (registry `purchase_confirm`; plugin receipt PDF intact).
- MIX vs PURCHASE/SERVICE: Gateway parses `绾喛顓婚懓妤佹灐`; cross-type confirm rejected.
- MIX PDF **not** implemented 閳?text receipt only (`pdfStatus=NONE` / no purchase PDF claim).
- Soft Excel prepare: pure MIX/SERVICE files return null so 016M/016S helpers can run (no PURCHASE rows).
- After #41 merges: still need integration rebase onto master for overlapping plugin/Confirm/Excel/Gateway.

## Evidence (non-post) 閳?this run

| Check | Result |
|--------|--------|
| `node deploy/scripts/aierp-016m-mix-prepare.mjs` | **PASS** (ALL PASS; stock unchanged; GW-PURCHASE-119 untouched) |
| `node deploy/scripts/aierp-016m-mix-prepare-flow.mjs` | **PASS** 25 / FAIL 0 |
| Boot | local `aierp-boot` restarted with rebuilt `jshERP.jar` from this worktree (no F: overwrite) |

JSON/MD: `docs/poc/evidence/aierp-016m-mix-prepare*.json|md`

## NOT_VERIFIED

- Human WeCom MIX UAT (`绾喛顓婚柊宥呭煑{newId}` on a fresh draft 閳?FG-101 +1L / raw deltas)
- Native MIX PDF (intentionally not implemented)
- Integration rebase after #41 merges onto master
- Production / F: OpenClaw deploy
