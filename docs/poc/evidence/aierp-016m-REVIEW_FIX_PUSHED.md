# AIERP-016M REVIEW_FIX_PUSHED

- **Status**: `REVIEW_FIX_PUSHED`
- **Branch**: `feat/aierp-016m-mix-sop`
- **HEAD**: _(filled after push)_
- **PR**: https://github.com/youxihe/ai-erp/pull/42
- **Base note**: #41 not yet merged; recipe-hash fix landed on current branch (rebase later)

## P0 fix (ChatGPT Round 1)

Model booleans `recipeUserConfirmed` / `userConfirmedRecipe` are **never** proof of human recipe approval.

| Path | Behavior |
|------|----------|
| `/mix/recipe-preview` | Shows full finished + raw lines; registers deterministic SHA-256 `recipeHash` (PROPOSED draft) |
| `/mix/prepare` | Requires server-registered `recipeHash`; rejects boolean-only shortcuts with explicit 400 (even if Excel DRAFT_READY is open) |
| Excel MIX preview | Auto-draft from verified XLSX cells; binds `recipeHash`; summary never claims「用户已确认」 |
| Confirm | Trusted WeCom `确认配制{draftId}` only; `确认采购` / `确认耗料` cross-type rejected |
| Receipt | MIX text-only (`pdfStatus=NONE`); no fake purchase PDF |

## Files changed

- `jshERP-boot/.../AierpWecomMixService.java` — recipeHash / ignore model booleans
- `jshERP-boot/.../AierpWecomController.java` — `/mix/recipe-preview`
- `jshERP-boot/.../AierpWecomExcelService.java` — MIX soft-path not masked by PURCHASE soft-fail
- `jshERP-boot/.../AierpGatewayService.java` — parse `确认耗料` for cross-type reject (prep for #41 rebase)
- `jshERP-boot/.../LogCostFilter.java` — whitelist recipe-preview
- `deploy/openclaw/**/mix-prepare.mjs` — SOP builds require `recipeHash`
- `deploy/openclaw/workspace/skills/erp-mixing/SKILL.md`
- `deploy/scripts/aierp-016m-mix-prepare.mjs` / `aierp-016m-mix-prepare-flow.mjs`
- `deploy/Dockerfile.boot` + `deploy/scripts/maven-central-settings.xml` (Central-only Maven mirror)

## Automated results (non-post)

| Suite | Result |
|-------|--------|
| `aierp-016m-mix-prepare.mjs` | **ALL PASS** (incl. boolean-alone reject, cross-type 确认采购/确认耗料, insufficient stock via recipeHash) |
| `aierp-016m-mix-prepare-flow.mjs` | **25/25 PASS** (recipe-preview → prepare; no「用户已确认」) |

Evidence JSON/MD: `docs/poc/evidence/aierp-016m-mix-prepare*.json|md`

## NOT_VERIFIED

- **Real WeCom MIX post**: live private-chat `确认配制{draftId}` → native `GW-MIX-*` + stock delta (FG + raw) **not** exercised this round
- No F:\\aierp-openclaw overwrite; no auto inventory post; no live draft confirm
- Dedicated MIX PDF template still absent (honest text receipt only)

## UAT tip

1. Upload MIX Excel (3 raw → FG-101) or recipe-preview → prepare with returned `recipeHash`
2. Verify draft summary shows full recipe + hash, phrase `确认配制{id}`
3. Reply exact phrase in WeCom DM; confirm stock; reject any「用户已确认」from model tools alone
