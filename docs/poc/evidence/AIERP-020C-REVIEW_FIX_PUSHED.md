# AIERP-020C · REVIEW_FIX_PUSHED

**PR**: https://github.com/youxihe/ai-erp/pull/50  
**Branch**: `feat/aierp-020c-render-table-chart-library`  
**Base master**: `2baf96c4`  
**Status**: `CODE_READY` — **not** `LOCAL_DEPLOYED` — **not** `WE_COM_UAT` (Bot WS image send deferred to 020B)

## Round-1 fixes

### P0 — stop caller-forged ERP provenance
- Added `dataset-registry.mjs`: trusted adapters call `sealDataset(authCtx, dataset)` after a real authorized ERP query; model only receives opaque `ds_<32hex>`.
- `validateRenderRequest` **rejects** caller `authorized:true`, `nature:"REAL_ERP"`, `sourceRefs`, and inline `dataset`.
- Resolve re-checks `tenantId` / `actorUserId` / `wecomUserId` / `botId` / `bindingVersion` / TTL.
- Cross-actor and binding-version mismatch negatives covered in smoke.

### P1 — media isolation + formula / scale guards
- PNG/XLSX written under fixed media root → `{tenant}/{actor}/` with unique stems (no title overwrite).
- Model cannot pass `outDir` / `filePath` / `toUserId`.
- `sanitizeSpreadsheetCell` neutralizes `= + - @` formula injection.
- Row/category/KPI/number magnitude caps in validate.

### Templates retained
`table.basic` / `bar.compare` / `line.trend` / `pie.share` / `delta.before_after` / `kpi.tiles`

## Tests (non-posting)

```text
node deploy/scripts/aierp-020c-render-smoke.mjs
→ ok=true, 28/28 checks
```

Evidence: `docs/poc/evidence/aierp-020c-render-smoke.json`

### Real authorized ERP (not fixture-as-stats)
| Check | Result |
|---|---|
| bind claim ACTIVE | PASS |
| stock/query 原料仓 表面活性剂 | PASS — RM-A001 currentStock **347.7** L (bound jsh) |
| seal + table PNG | PASS — provenance `SERVER_SEALED_ERP` |
| report/query purchase_in_summary | PASS — nature `REAL_ERP`, billCount **32** |
| seal + bar PNG | PASS |

Fixture template smoke is labeled `SMOKE_FIXTURE_NOT_ERP_STATS` / `fixtureOnly:true` and is **not** claimed as ERP statistics.

## Deploy

| Gate | State |
|---|---|
| GitHub CODE_READY | YES (this push) |
| LOCAL_DEPLOYED (F:/jar) | **NO** — intentionally untouched |
| WE_COM_UAT (client image) | **PENDING** — 020B |

Do not Merge from Cursor; ChatGPT Review/Merge owns the PR.
