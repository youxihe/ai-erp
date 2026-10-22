# AIERP-016M · INTEGRATION_FIX_PUSHED (PR #42 × master #41)

## Status

**INTEGRATION_FIX_PUSHED**

## Identity

| Field | Value |
|---|---|
| Branch | `feat/aierp-016m-mix-sop` |
| Repo | `youxihe/ai-erp` only |
| PR | https://github.com/youxihe/ai-erp/pull/42 |
| Pre-integration tip | `63ff11a764f23d48ca4584cec2f7086bc087e21b` |
| Merged `origin/master` (#41) | `db13699fc743debe06665aca4d043ba526844ddc` |
| Merge commit | `d60480744612abd21a27093395a38d270bc5ee3c` |
| Evidence/suite tip | `588d50bc1fa4124059802bbc074cb9be93c01176` (INTEGRATION doc + suite JSON) |
| **Remote HEAD** | `c3fd7d50d8a1511b164e4888988b5f79b63cdc64` |
| Merge | **Do not self-merge** to master from this agent |
| F: / stock | No F: OpenClaw overwrite; no auto stock post |

## Conflict resolutions (keep BOTH)

| File | Resolution |
|---|---|
| `AierpWecomExcelService` | Keep 017B2 batch/`selectedBusinessKeys`/`RECONCILIATION_REQUIRED`/immutable `revision` **and** soft-path: pure MIX/SERVICE (no PURCHASE) returns `null` so 016M mix helpers run; preview still tries purchase then MIX. |
| `AierpWecomController` | Both `AierpWecomMixService` + `AierpWecomPurchaseBatchService`; both `/excel/prepare-verified-batch` + `/excel/purchase-batch-prepare` **and** `/mix/prepare*`, `/mix/recipe-preview`, `/mix/recipe-ack`. |
| `LogCostFilter` | Allowlist both batch Excel URLs and mix recipe/prepare URLs; receipt PDF paths unchanged. |
| `sop/registry.mjs` (plugin + mirror) | Register receipt + mix recipe-ack/confirm + purchase confirm + `purchase_batch_prepare` + `mix_prepare`; export both MIX and batch helpers. |
| `AGENTS.md` | Keep mix confirm/template rows **and** purchase-batch / audited-replay rows. |

Auto-merged without conflict markers (verified): `AierpGatewayService` (distinct `确认采购` / `确认配制` / `确认耗料`), `AierpExcelService`, plugin `index.js` (015C receipt PDF + mix dispatch), skills.

## Not committed (ops / local only)

- `deploy/docker-compose.boot-hot.yml`, `deploy/scripts/hot-reload-boot.ps1`, `deploy/runtime/`, `deploy/.m2-repo/` (ops PR separate; no Dockerfile/maven mirror edits on this branch)

## Automated results (non-posting)

Worktree: `D:\ERP\ai-erp-016m`. Boot: jar from this worktree (`mvn package` BUILD SUCCESS) bind-mounted into `aierp-boot` (shared compose mount path). At: `2026-10-22T17:56Z` approx.

| Suite | Result |
|---|---|
| `node deploy/scripts/aierp-017b2-multi-purchase.mjs` | **18/18 PASS** |
| `node deploy/scripts/aierp-016m-mix-prepare.mjs` | **22/22 PASS** (ALL PASS; suite > legacy 20) |
| `node deploy/scripts/aierp-016m-mix-prepare-flow.mjs` | **28/28 PASS** (suite > legacy 25) |
| Java compile (`mvn -DskipTests package` via hot-reload) | **BUILD SUCCESS** |

Cross-match / receipt: suite asserts reject `确认采购` / `确认耗料` on MIX drafts; purchase audited replay still offers PDF path; stock unchanged on all non-post suites.

JSON/MD: `docs/poc/evidence/aierp-016m-mix-prepare*.json|md`, `docs/poc/evidence/aierp-017b2-multi-purchase.json`

## NOT_VERIFIED / LIVE_WECOM=NOT_VERIFIED

- Human WeCom MIX UAT (`确认配制{newId}` → FG-101 +1L / raw deltas)
- Live WeCom channel end-to-end (purchase multi-bill + mix + receipt PDF in one session)
- Native MIX PDF (intentionally not implemented; text receipt only)
- F: shared OpenClaw plugin deploy (not overwritten)
- Self-merge to master (forbidden)

## Hard rules honored

- No self-merge
- No F: overwrite
- No automatic native stock write / no real MIX or purchase post in suites
