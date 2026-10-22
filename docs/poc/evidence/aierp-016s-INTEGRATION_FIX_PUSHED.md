# AIERP-016S Â· INTEGRATION_FIX_PUSHED (PR #43 Ã— master #41/#42/#47)

## Status

**INTEGRATION_FIX_PUSHED**

## Identity

| Field | Value |
|---|---|
| Branch | `feat/aierp-016s-service-outbound-sop` |
| Worktree | `D:\ERP\ai-erp-016s` |
| Repo | `youxihe/ai-erp` only |
| PR | https://github.com/youxihe/ai-erp/pull/43 |
| Pre-integration tip (#43 HEAD) | `0d576c4b` |
| Merged `origin/master` (#41+#42+#47) | `0c841fbd` (#41 `db13699f`, #42 `bccd9f52`, #47 `0c841fbd`) |
| Merge commit | `a07ad04d` Integrate master multi-purchase, MIX, and boot hot-reload into SERVICE branch |
| **Remote HEAD** | `ba155c87981c351c3a1b0516060531231a10aea7` |
| Merge | **Do not self-merge** to master from this agent |
| F: / stock | No F: OpenClaw overwrite; no auto stock post; do not re-post GW-PURCHASE-119 / GW-SERVICE-136 |

## Conflict resolutions (keep ALL)

| Area | Resolution |
|---|---|
| `AierpWecomExcelService` | Master 017B2 batch/`selectedBusinessKeys`/RECONCILIATION + MIX soft-path; SERVICE helpers `peekWorkflow` / `putOwnedWorkflow` / `loadOwnedPreviewPayload` / `shortIdempotencyKeyFor`; 3-arg `markWorkflowPosted` (SERVICEã€Œå·²å‡ºåº“ã€?vs purchaseã€Œå·²å…¥åº“ã€?. |
| `AierpGatewayService` | Purchase / MIX / SERVICE confirm phrases; UserCustomer assert on `resolveOrgan` for å®¢æˆ·; CONFIRMED idempotent replay **before** normalize (and DuplicateKey race path) so audited GW-SERVICE-136 is not blocked by stock drift. |
| `AierpWecomReceiptService` / plugin | 015C purchase PDF media send; SERVICE+MIX skip fake purchase PDF. |
| `sop/registry.mjs` (plugin + mirror) | Priority: receipt â†?mix_recipe_ack â†?mix_confirm â†?service_confirm â†?purchaseâ€? batch + mix_prepare present. |
| Controller / Confirm / QUEUE / AGENTS | SERVICE consume + MIX recipeHash dual-confirm + purchase batch rows retained. |

## Jar under test

| Field | Value |
|---|---|
| Source | **This worktree** `D:\ERP\ai-erp-016s` (integrated #43), not master deploy worktree |
| Build | `mvn -B -DskipTests package` via `maven:3.9.6-eclipse-temurin-8` â†?`deploy/runtime/app.jar` |
| Hot-reload | Manual compile + `docker compose â€?-f docker-compose.boot-hot.yml up -d --force-recreate --no-deps aierp-boot` (same bind-mount path as `deploy/scripts/hot-reload-boot.ps1`) |
| Host SHA256 | `e6a69a572bbfcaee737534ab2fc27ab9b134a1fd53940b023ef0bc360b9533a9` |
| Container `/app/app.jar` | **match** same SHA256 |
| Boot | `http://127.0.0.1:9999` single `aierp-boot` |

## Automated results (non-posting)

`AIERP_016S_CONFIRM` unset. At: `2026-10-22T19:01Z` approx (SERVICE evidence `at`).

| Suite | Result |
|---|---|
| Java compile (`mvn -DskipTests package`) | **BUILD SUCCESS** |
| `node deploy/scripts/aierp-017b2-multi-purchase.mjs` | **18/18 PASS** |
| `node deploy/scripts/aierp-016m-mix-prepare.mjs` | **22/22 PASS** |
| `node deploy/scripts/aierp-016m-mix-prepare-flow.mjs` | **28/28 PASS** |
| `node deploy/scripts/aierp-016s-service-consume.mjs` | **PASS** (non-post; UserCustomer + cross-type + audited GW-SERVICE-136 replay; confirm skipped) |

JSON/MD: `docs/poc/evidence/aierp-016s-service-consume.json`, `aierp-016m-mix-prepare*.json|md`, `aierp-017b2-multi-purchase.json`

## NOT_VERIFIED / LIVE_WECOM=NOT_VERIFIED

- Human WeCom SERVICE UAT (`ç¡®è®¤è€—æ–™{newId}` â†?FG-101 -1L; do **not** re-post GW-SERVICE-136)
- Live WeCom channel end-to-end (purchase multi-bill + mix + service + receipt PDF in one session)
- SERVICE native PDF (if not yet productized; purchase 015C path preserved)
- F: shared OpenClaw plugin deploy (not overwritten)
- Self-merge to master (forbidden)

## Hard rules honored

- No self-merge
- No F: overwrite
- No automatic native stock write / no real SERVICE or MIX or purchase post in suites
- No re-post of audited #119 / #136
