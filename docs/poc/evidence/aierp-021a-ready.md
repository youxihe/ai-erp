# AIERP-021A READY_FOR_REVIEW

- **Branch**: `feat/aierp-021a-partner-masterdata-sop`
- **Base**: `origin/master` @ `74b32fe8`
- **Scope**: WeCom prepare?confirm create/update of ERP `Supplier` (`???`|`??`). No stock / purchase / mix / service post.
- **No merge / no F:** OpenClaw F: runtime not deployed from this branch.

## Deliverables

| Area | Path |
|---|---|
| Java facade | `AierpWecomMasterDataService` (`createPartnerAs` / `updatePartnerAs` + prepare/commit) |
| API | `POST /aierp/v1/wecom/master/partner/prepare` · `.../commit` |
| Auth filter allowlist | `LogCostFilter` (annotation + explicit doFilter) |
| Schema | `deploy/sql/08-aierp-021a-partner-master.sql` (+ seed-demo) |
| SOP | `sop/partner-upsert.mjs` + registry priority `partner_confirm` |
| Plugin (light) | `erp_partner_prepare` tool + before_dispatch `????/????` ? commit (**no** LLM commit tool) |

## Automated tests

`node deploy/scripts/aierp-021a-partner-master.mjs` ? **20/20 PASS**  
Evidence: `docs/poc/evidence/aierp-021a-partner-master.json`

Covered: prepare zero `jsh_supplier` insert; commit real id/type/tenant/creator; replay idempotent; update whitelist-only (bank/tax/balance untouched); negatives (dup name, wrong type, unbound, group, LLM self-confirm, rebind invalidate); stock unchanged; new supplier searchable.

## Live WeCom UAT

`NOT_RUN` — F: unified plugin deploy deferred. Local HMAC + DB facts verified (20/20).

## Gaps

- Human WeCom DM screenshots pending
- F: OpenClaw plugin integrate deferred (do not overwrite running plugin)
- Cross-device concurrent update race: recordDigest covered; multi-user live UAT optional

## Review ask

Please review and merge when ready. **Do not auto-merge from agent.**
