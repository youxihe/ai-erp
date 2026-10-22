# AIERP-016S · 服务耗料出库自动化证据

## Scope

- Branch: `feat/aierp-016s-service-outbound-sop`
- Biz: `SERVICE` = native `出库/其它` (**≠** 销售出库 / 开票 / 应收)
- Confirm phrase: `确认耗料{数字draftId}` (before_dispatch only; no LLM confirm tool)
- **Did not** overwrite shared `F:\aierp-openclaw` plugin; Cursor does not Merge

## Script

`deploy/scripts/aierp-016s-service-consume.mjs` with `AIERP_016S_CONFIRM=1` (controlled 1 L FG-101 post for idempotent replay).

JSON: `docs/poc/evidence/aierp-016s-service-consume.json`

## Results (PASS)

| Check | Result |
|---|---|
| SOP registry `service_confirm` / phrase parse | PASS |
| Real customer 苏州精密电子 | PASS |
| Bad customer rejected | PASS → 400 |
| Overstock rejected at prepare | PASS → 400 |
| `service/prepare` → DRAFT + `确认耗料{id}` | PASS `#136` |
| Prepare stock unchanged | PASS 150→150 |
| `确认采购{id}` on SERVICE rejected | PASS |
| Trusted confirm → `GW-SERVICE-136` | PASS |
| 成品仓 N−1 | PASS 150→149 |
| 原料仓 unchanged | PASS 250.7 |
| Native `出库/其它` audited | PASS |
| Confirm replay no double outbound | PASS |
| Receipt title 《服务耗料出库回执》 text; `pdfStatus=NONE` | PASS (honest) |

## Human WeCom UAT

- [ ] New draft via dialog/Excel; reply `确认耗料{n}` once
- [ ] Do not confirm purchase #119 / unrelated drafts
