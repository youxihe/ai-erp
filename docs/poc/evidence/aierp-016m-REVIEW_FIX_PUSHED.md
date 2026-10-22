# AIERP-016M REVIEW_FIX_PUSHED

- **Status**: `REVIEW_FIX_PUSHED`
- **Branch**: `feat/aierp-016m-mix-sop`
- **HEAD**: `144941d3798df00e4f16753644ea1c62bc10eb07`
- **PR**: https://github.com/youxihe/ai-erp/pull/42
- **Base note**: #41 not yet merged; recipe-hash fix landed on current branch (rebase later)

## P0 fix (ChatGPT Round 1)

Model booleans `recipeUserConfirmed` / `userConfirmedRecipe` are **never** proof of human recipe approval.

| Path | Behavior |
|------|----------|
| `/mix/recipe-preview` | Shows full finished + raw lines; registers deterministic SHA-256 `recipeHash` (PROPOSED draft) |
| `/mix/prepare` | Requires server-registered `recipeHash`; rejects boolean-only shortcuts with explicit 400 (even if Excel DRAFT_READY is open) |
| Excel MIX preview | Auto-draft from verified XLSX cells; binds `recipeHash`; summary never claims銆岀敤鎴峰凡纭銆?|
| Confirm | Trusted WeCom `纭閰嶅埗{draftId}` only; `纭閲囪喘` / `纭鑰楁枡` cross-type rejected |
| Receipt | MIX text-only (`pdfStatus=NONE`); no fake purchase PDF |

## Files changed

- `jshERP-boot/.../AierpWecomMixService.java` 鈥?recipeHash / ignore model booleans
- `jshERP-boot/.../AierpWecomController.java` 鈥?`/mix/recipe-preview`
- `jshERP-boot/.../AierpWecomExcelService.java` 鈥?MIX soft-path not masked by PURCHASE soft-fail
- `jshERP-boot/.../AierpGatewayService.java` 鈥?parse `纭鑰楁枡` for cross-type reject (prep for #41 rebase)
- `jshERP-boot/.../LogCostFilter.java` 鈥?whitelist recipe-preview
- `deploy/openclaw/**/mix-prepare.mjs` 鈥?SOP builds require `recipeHash`
- `deploy/openclaw/workspace/skills/erp-mixing/SKILL.md`
- `deploy/scripts/aierp-016m-mix-prepare.mjs` / `aierp-016m-mix-prepare-flow.mjs`
- `deploy/Dockerfile.boot` + `deploy/scripts/maven-central-settings.xml` (Central-only Maven mirror)

## Automated results (non-post)

| Suite | Result |
|-------|--------|
| `aierp-016m-mix-prepare.mjs` | **ALL PASS** (incl. boolean-alone reject, cross-type 纭閲囪喘/纭鑰楁枡, insufficient stock via recipeHash) |
| `aierp-016m-mix-prepare-flow.mjs` | **25/25 PASS** (recipe-preview 鈫?prepare; no銆岀敤鎴峰凡纭銆? |

Evidence JSON/MD: `docs/poc/evidence/aierp-016m-mix-prepare*.json|md`

## NOT_VERIFIED

- **Real WeCom MIX post**: live private-chat `纭閰嶅埗{draftId}` 鈫?native `GW-MIX-*` + stock delta (FG + raw) **not** exercised this round
- No F:\\aierp-openclaw overwrite; no auto inventory post; no live draft confirm
- Dedicated MIX PDF template still absent (honest text receipt only)

## UAT tip

1. Upload MIX Excel (3 raw 鈫?FG-101) or recipe-preview 鈫?prepare with returned `recipeHash`
2. Verify draft summary shows full recipe + hash, phrase `纭閰嶅埗{id}`
3. Reply exact phrase in WeCom DM; confirm stock; reject any銆岀敤鎴峰凡纭銆峟rom model tools alone
