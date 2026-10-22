# AIERP-021A READY_FOR_REVIEW

- **Branch**: `feat/aierp-021a-partner-masterdata-sop`
- **HEAD**: `e9fdd09692993aa7ba513e540988fd6339fa2b99`
- **Base**: `origin/master` @ `74b32fe8`
- **Scope**: WeCom prepare→confirm create/update of ERP `Supplier` (供应商|客户). No stock / purchase / mix / service post.
- **No merge / no F:** plugin `index.js` not wired; shared OpenClaw runtime untouched.

## Deliverables

| Area | Path |
|---|---|
| Java facade | `AierpWecomMasterDataService` (`createPartnerAs` / `updatePartnerAs` + prepare/commit) |
| API | `POST /aierp/v1/wecom/master/partner/prepare` · `.../commit` |
| Auth filter allowlist | `LogCostFilter` |
| Schema | `deploy/sql/08-aierp-021a-partner-master.sql` (+ seed-demo) |
| SOP | `sop/partner-upsert.mjs` + registry priority `partner_confirm` |
| Plugin | **not** edited (`index.js` / F: deploy deferred) |

## Automated tests

`node deploy/scripts/aierp-021a-partner-master.mjs` �?**20/20 PASS**  
Evidence: `docs/poc/evidence/aierp-021a-partner-master.json`

Covered: prepare zero `jsh_supplier` insert; commit real id/type/tenant/creator; replay idempotent; update whitelist-only (bank/tax/balance untouched); negatives (dup name, wrong type, unbound, group, LLM self-confirm, rebind invalidate); stock unchanged; new supplier searchable.

## Live WeCom UAT

`NOT_RUN` �?channel `plugin/index.js` wiring deferred to F: unified integrate. Local HMAC + DB facts verified.

## Review ask

Please review and merge when ready. **Do not auto-merge from agent.**
