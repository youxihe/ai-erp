# AIERP-016M REVIEW_FIX_PUSHED

- Branch: `feat/aierp-016m-mix-sop`
- PR: https://github.com/youxihe/ai-erp/pull/42
- HEAD: *(filled after push)*
- LIVE_WECOM: **NOT_VERIFIED**
- Live ERP non-post suite: **NOT_RUN** (Docker Desktop engine unavailable after OOM during boot rebuild; SOP unit checks PASS)

## Round-1 P0 fix

Model boolean `recipeUserConfirmed` / `userConfirmedRecipe` no longer authorizes slot MIX prepare.

| Gate | Behavior |
|---|---|
| `/mix/recipe-preview` | Registers server-side `recipeHash` + full finished/raw display (`PROPOSED`) |
| `/mix/prepare` | Requires registered `recipeHash`; ignores model booleans; never claims「用户已确认」 |
| Post | Trusted WeCom原文「确认配制{draftId}」only |
| Cross-type | 「确认采购」「确认耗料」on MIX draft rejected |

## Files

- `jshERP-boot/.../AierpWecomMixService.java` — recipeHash preview + prepare verification
- `jshERP-boot/.../AierpWecomController.java` — `POST /mix/recipe-preview`
- `jshERP-boot/.../AierpGatewayService.java` — parse `确认耗料` for cross-type reject
- `jshERP-boot/.../LogCostFilter.java` — allow `/mix/recipe-preview`
- `deploy/openclaw/sop/mix-prepare.mjs` (+ plugin mirror) — hash builders; no boolean shortcut
- `deploy/openclaw/sop/registry.mjs` (+ plugin mirror) — MIX confirm = `确认配制{id}` only
- `deploy/openclaw/workspace/skills/erp-mixing/SKILL.md`
- `deploy/scripts/aierp-016m-mix-prepare*.mjs` — boolean/hash/cross-type non-post checks
- `deploy/Dockerfile.boot` + `deploy/scripts/maven-central-settings.xml` — Central-only Maven mirror for rebuilds

## Tests

- SOP unit (no ERP): **PASS** (phrase / boolean refuse / recipeHash required / registry route)
- Live `aierp-016m-mix-prepare*.mjs` against boot: **NOT_RUN** (Docker engine down)
- Inventory auto-post: **not exercised**
- F: OpenClaw overwrite: **not done**

## UAT (human)

1. recipe-preview → show full FG/RM → prepare with returned `recipeHash` → 原文「确认配制{id}」
2. Ensure boolean-only prepare fails; 确认采购/确认耗料 on MIX draft fails
3. MIX receipt remains text-only (`pdfStatus=NONE`); purchase PDF path untouched
