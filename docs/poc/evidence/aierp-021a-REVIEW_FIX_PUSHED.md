# AIERP-021A REVIEW_FIX_PUSHED

- **Ticket**: AIERP-021A (PR #44 partner masterdata)
- **Branch**: `feat/aierp-021a-partner-masterdata-sop`
- **Status**: `REVIEW_FIX_PUSHED`
- **HEAD**: `a811a0974d3db83483583bdc7f6b873bdada050d`
- **Scope**: ChatGPT Round 1 REVIEW_FIX only (no merge, no F: overwrite, no inventory auto-post)
## Coordinated naming (vs AIERP-021B / PR #45)

| Item | Chosen value |
|---|---|
| Java class | `AierpWecomPartnerMasterDataService` (unique path; **not** shared `AierpWecomMasterDataService`) |
| Confirm CREATE | `确认伙伴建档{requestId}` |
| Confirm UPDATE | `确认伙伴修改{requestId}` |
| SOP registry key | `partner_confirm` |

Rejected / must not collide with material:

- bare `确认建档{id}` / `确认修改{id}`
- `确认建档物料{id}` (021B)
- ambiguous type-infix forms are **not** used as the partner namespace (`确认建档供应商{id}` etc. are rejected by partner parser)

## P0 fixes

1. **Cross-sender/tenant replay**
   - `commitInTx` loads by **parsed request id** first (`FOR UPDATE`).
   - Ownership + binding checks run **before** any `alreadyConsumedView`.
   - Idempotent replay only returns the **owned** CONSUMED row.
   - Same `consume_message_id` on another actor/tenant does **not** leak `partnerId` / result.
2. **#45 class collision**
   - Renamed facade to `AierpWecomPartnerMasterDataService`; Controller injects that type only.

## P1 fixes

1. **`assertCustomerVisible`**: when `jsh_system_config.customer_flag=1`, missing `UserCustomer` assignment **denies** (no global access).
2. **Duplicate-name race**: MySQL `GET_LOCK` around create/rename + `assertNameAvailable` inside the lock.

## Tests

| Test | Result |
|---|---|
| `node deploy/scripts/aierp-021a-partner-phrase-unit.mjs` | run at push time (offline phrase namespace) |
| `AierpWecomPartnerMasterDataServicePhraseTest` | offline JUnit phrase rejects bare/material/typed |
| `node deploy/scripts/aierp-021a-partner-master.mjs` | includes cross-sender / cross-tenant msgid negatives + bare/material/typed rejects; live ERP may be `NOT_VERIFIED` if boot unavailable |

## NOT_VERIFIED

- Live WeCom DM UAT / F: OpenClaw runtime deploy (explicitly out of scope)
- Full HMAC integration against local `aierp-boot` if container not up at push time
- Production inventory / stock (must remain unchanged; not re-verified here if ERP down)
