# AIERP-022A · CODE_READY evidence

## Scope
Unified mutation audit + immutable PDF receipts for PURCHASE / MIX / SERVICE.
Branch: `feat/aierp-022a-unified-mutation-audit-pdf` (from origin/master `cf96c8dd`).
Status: **CODE_READY** (not LOCAL_DEPLOYED). No Merge. No F: / app.jar touch. No re-confirm of GW-PURCHASE-119 / GW-SERVICE-136.

## Code changes
| File | Change |
|---|---|
| `AierpWecomReceiptService.java` | Immutable PDFs: never overwrite existing bytes/sha; layoutVersion writes new file; dedicated MIX/SERVICE PDF templates; PDF failure after confirm does not re-post |
| `AierpMutationAuditService.java` | Append-only audit event + versioned PDF hooks (partner/material/batch reusable) |
| `deploy/sql/08-aierp-022a-mutation-audit.sql` | `aierp_gateway_audit_event`, `aierp_gateway_receipt_pdf_version`, optional receipt columns |

## Non-post verification notes
1. Do **not** run `确认采购119` / `确认耗料136` / any stock-posting confirm.
2. Apply SQL `08-aierp-022a-mutation-audit.sql` on demo DB before runtime UAT (Deploy Owner).
3. Read-only: request `发 GW-PURCHASE-119 回执` → must return PDF; original v1 file path must still exist after layout bump; version table keeps prior sha.
4. Historical MIX/SERVICE with `pdf_status=NONE`: materialize dedicated titled PDF (组装配制业务回执 / 服务耗料出库回执), never 采购入库业务回执.
5. Forced PDF font failure → receipt stays `PDF_FAILED` / text ready; native bill remains CONFIRMED; stock unchanged.

## Java BUILD
Local: `mvn -DskipTests package` in `jshERP-boot` → **BUILD SUCCESS** (Temurin JDK8 + Maven 3.9.6).
HEAD: `2cc96ff489574ed6672aa2cfe9807b71257f523e`

## PR
Branch pushed: `feat/aierp-022a-unified-mutation-audit-pdf`
Open/compare: https://github.com/youxihe/ai-erp/compare/master...feat/aierp-022a-unified-mutation-audit-pdf
(`gh` CLI not authenticated on this agent host — create PR from compare URL if not auto-opened.)
