# AIERP-016M REVIEW_FIX_PUSHED

**Branch:** `feat/aierp-016m-mix-sop`  
**Repo:** `youxihe/ai-erp`  
**PR:** https://github.com/youxihe/ai-erp/pull/42  
**Status:** `REVIEW_FIX_PUSHED` — no Merge; no F: OpenClaw overwrite; no MIX native post / stock write.  
**Evidence at:** 2026-10-23 ~01:58 +08:00  
**Remote HEAD:** _(pinned in follow-up commit after push)_

## ChatGPT Round-1 P0 — model boolean ≠ human approval

| Requirement | Implementation |
|---|---|
| Distinguish proposed DRAFT vs user-confirmed formula | `/mix/recipe-preview` → `recipeStatus=PROPOSED` + server `recipeHash` (SHA-256 of finished+raw qty). Trusted DM `确认配方{hash}` → `/mix/recipe-ack` → `USER_ACKED`. |
| Refuse invented ratios | Prepare requires registered hash; optional client finished/lines must match stored hash; no chemistry invention. |
| Full recipe shown before trusted ack | `recipeDisplayZh` lists finished + all raw lines + ack phrase before USER_ACKED. |
| Never treat model boolean as approval | `recipeUserConfirmed` / `userConfirmedRecipe` alone → 400; boolean ignored even with hash — only Redis `USER_ACKED` authorizes `/mix/prepare`. |
| Explicit recipe confirmation hash | Server-computed hash; user must reply original `确认配方{short\|full hash}` on WECOM_BEFORE_DISPATCH (not model tool). |

Posting remains trusted original DM `确认配制{draftId}` only. **MIX PDF is not implemented** (accurate text receipt only).

## Integration P0

- PURCHASE confirm + PDF attachment paths preserved (`purchase_confirm` / receipt PDF purchase-only).
- MIX / SERVICE / PURCHASE intents distinct; cross-type confirm of wrong draft rejected (non-post probes).
- Shared files after master #41 merge: keep MIX recipe-ack/prepare **and** purchase-batch paths (see `aierp-016m-INTEGRATION_FIX_PUSHED.md`).

## Key files

- `jshERP-boot/.../AierpWecomMixService.java` — preview / ack / USER_ACKED gate / hash helpers
- `jshERP-boot/.../AierpWecomController.java` — `/mix/recipe-preview`, `/mix/recipe-ack`, `/mix/prepare`
- `jshERP-boot/.../LogCostFilter.java` — allowlist recipe-preview + recipe-ack
- `deploy/openclaw/**/mix-prepare.mjs`, `register-mix-recipe-ack.mjs`, `registry.mjs`, `index.js`
- `deploy/scripts/aierp-016m-mix-prepare*.mjs`

## Automated non-post results (this run)

| Check | Result |
|--------|--------|
| `node deploy/scripts/aierp-016m-mix-prepare.mjs` | **22/22 PASS** (boolean alone rejected; unacked hash 409; cross-type 确认采购/确认耗料 rejected; stock unchanged; GW-PURCHASE-119 untouched) |
| `node deploy/scripts/aierp-016m-mix-prepare-flow.mjs` | **28/28 PASS** (preview → 确认配方 → prepare; reject wrong phrases; stock unchanged) |
| Boot | `deploy-aierp-boot` rebuilt from this worktree; no F: OpenClaw overwrite |

JSON/MD: `docs/poc/evidence/aierp-016m-mix-prepare*.json|md`

## NOT_VERIFIED

- Human WeCom MIX post (`确认配制{draftId}` live DM → stock move + text receipt) — **not** run by this agent.
- Live purchase PDF regression on WeCom — not re-shot here; code paths preserved only.
