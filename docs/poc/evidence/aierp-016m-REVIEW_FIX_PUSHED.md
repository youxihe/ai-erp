# AIERP-016M REVIEW_FIX_PUSHED

**Branch:** `feat/aierp-016m-mix-sop`
**PR:** https://github.com/youxihe/ai-erp/pull/42
**Status:** `REVIEW_FIX_PUSHED` — no Merge; no F: OpenClaw overwrite; no MIX native post / stock write.
**HEAD:** 3b8024e743cdd377ae802839759b708ddd11700a
**Evidence at:** 2026-10-23 ~01:25 +08:00

## Round-1 fixes (ChatGPT P0)

### P0 — model boolean ≠ human approval
- Slot path: `/mix/recipe-preview` registers server-side **PROPOSED** `recipeHash` and shows full finished + raw recipe.
- Trusted WeCom original message `确认配方{hash}` marks proposal **USER_ACKED** (`/mix/recipe-ack`, before_dispatch only).
- `/mix/prepare` requires a **USER_ACKED** registered `recipeHash`. Model `recipeUserConfirmed` / `userConfirmedRecipe` alone are rejected (including while Excel DRAFT_READY is open — boolean check runs before workflow 409).
- Posting remains trusted original DM `确认配制{draftId}` only. MIX PDF is **not** implemented (text receipt only).
- Invented ratios / missing / unknown / unacked hash refused; optional client finished/lines must match stored hash.
- Plugin SOP mirrors Java: boolean without hash throws; hash + recipe-ack required before prepare.

### Integration
- PURCHASE confirm + PDF paths preserved (`purchase_confirm` + receipt PDF still purchase-only).
- MIX / PURCHASE / SERVICE phrases separated; Gateway parses `确认耗料`; cross-type confirm rejected.
- After #41 merges: still need integration rebase onto master for overlapping shared files.

## Changed files
- `jshERP-boot/.../AierpWecomMixService.java` — recipe-preview, recipe-ack (USER_ACKED), hash-gated prepare; boolean gate before workflow
- `jshERP-boot/.../AierpWecomController.java` — `/mix/recipe-preview`, `/mix/recipe-ack`, `/mix/prepare`
- `jshERP-boot/.../AierpGatewayService.java` — `确认耗料` parse + cross-type assert (already on branch)
- `jshERP-boot/.../LogCostFilter.java` — allowlist recipe-preview + recipe-ack
- `deploy/openclaw/**/mix-prepare.mjs`, `register-mix-recipe-ack.mjs`, `registry.mjs`, `index.js`, `erp-mixing/SKILL.md`
- `deploy/scripts/aierp-016m-mix-prepare*.mjs`

## Evidence (non-post) — this run

| Check | Result |
|--------|--------|
| `node deploy/scripts/aierp-016m-mix-prepare.mjs` | **22/22 PASS** (boolean alone rejected; cross-type 确认采购/确认耗料 rejected; stock unchanged; GW-PURCHASE-119 untouched) |
| `node deploy/scripts/aierp-016m-mix-prepare-flow.mjs` | **28/28 PASS** (preview→确认配方→prepare; reject wrong phrases; stock unchanged) |
| Boot | local jar bind-mounted from this worktree rebuild (no F: overwrite) |

JSON/MD: `docs/poc/evidence/aierp-016m-mix-prepare*.json|md`

## NOT_VERIFIED / LIVE_WECOM=NOT_VERIFIED

- Human WeCom MIX UAT (`确认配制{newId}` on a fresh draft → FG-101 +1L / raw deltas)
- Live WeCom channel end-to-end
- Native MIX PDF (intentionally not implemented)
- Integration rebase after #41 merges onto master
- F: shared OpenClaw plugin deploy (not overwritten)

## Hard rules honored

- No Merge
- No F: overwrite
- No automatic native stock write / no real MIX post
