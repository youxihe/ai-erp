# AIERP-021A REVIEW_FIX_PUSHED

- **Ticket**: AIERP-021A (PR #44 partner masterdata)
- **Branch**: `feat/aierp-021a-partner-masterdata-sop`
- **Status**: `REVIEW_FIX_PUSHED`
- **FINAL tip HEAD**: `cdb486d5abafc9ffa12bb5f31002295ead33e29c`
- **Scope**: ChatGPT Round 1 REVIEW_FIX only (no merge, no F: overwrite, no inventory auto-post)

## Coordinated naming (vs AIERP-021B / PR #45)

| Item | Chosen value |
|---|---|
| Java class | `PartnerMasterDataService` (unique path; **not** shared `AierpWecomMasterDataService`) |
| Confirm CREATE | `确认建档供应商{requestId}` / `确认建档客户{requestId}` |
| Confirm UPDATE | `确认修改供应商{requestId}` / `确认修改客户{requestId}` |
| SOP registry key | `partner_confirm` |

Rejected / must not collide with material:

- bare `确认建档{id}` / `确认修改{id}`
- `确认建档物料{id}` (021B)
- generic `确认伙伴建档{id}` (not used)

## P0 fixes

1. **Cross-sender/tenant replay**
   - `commitInTx` loads by **parsed request id** first (`FOR UPDATE`).
   - Ownership + binding checks run **before** any `alreadyConsumedView`.
   - Idempotent replay only returns the **owned** CONSUMED row.
   - Same `consume_message_id` on another actor/tenant does **not** leak `partnerId` / result.
2. **Partner vs Material split**
   - Renamed facade to `PartnerMasterDataService`; Controller injects that type only.
   - Confirm phrases type-namespaced so partner cannot commit material ids.

## P1 fixes

1. **`assertCustomerVisible`**: when `jsh_system_config.customer_flag=1`, missing `UserCustomer` assignment **denies** (no global access).
2. **Duplicate-name race**: MySQL `GET_LOCK` around create/rename + `assertNameAvailable` inside the lock.
3. **No unsafe finance fields**: whitelist-only; bank/tax/balance post-check unchanged.

## Files (this tip)

- `jshERP-boot/.../PartnerMasterDataService.java` (+ Controller inject)
- `jshERP-boot/.../PartnerMasterDataServicePhraseTest.java`
- `deploy/openclaw/sop/partner-upsert.mjs` (+ plugin copy)
- `deploy/openclaw/plugins/aierp-erp-tools/index.js` (prepare tool phrase text)
- `deploy/scripts/aierp-021a-partner-phrase-unit.mjs`
- `deploy/scripts/aierp-021a-partner-master.mjs`
- docs/queue + AGENT/UAT phrase alignment

## Tests

| Test | Result |
|---|---|
| `node deploy/scripts/aierp-021a-partner-phrase-unit.mjs` | **PASS** (typed phrases + bare/material/legacy reject + simultaneous partner/material namespace) |
| `PartnerMasterDataServicePhraseTest` | authored; `mvn` may be absent → **NOT_VERIFIED** in this environment |
| `node deploy/scripts/aierp-021a-partner-master.mjs` | cross-sender/tenant msgid negatives + bare/material pending survival + `customer_flag` deny; live ERP → see NOT_VERIFIED |

## NOT_VERIFIED

- Live WeCom DM UAT / F: OpenClaw runtime deploy (explicitly out of scope)
- Full HMAC integration against local `aierp-boot` if container not rebuilt at push time
- JUnit via Maven if `mvn` absent on PATH
- Production inventory / stock (must remain unchanged; not re-verified here if ERP down)
