# AIERP-021A REVIEW_FIX_PUSHED

- **Ticket**: AIERP-021A (PR #44 partner masterdata)
- **Branch**: `feat/aierp-021a-partner-masterdata-sop`
- **Status**: `REVIEW_FIX_PUSHED`
- **Remote HEAD**: `718fc3f9475990c5330edf1505f5b4d38a7dc5ac`
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
- partner-prefixed `确认伙伴建档{id}` is **not** accepted by this branch's parser

## P0 fixes

1. **Cross-sender/tenant replay**
   - `commitInTx` loads by **parsed request id** first (`FOR UPDATE`).
   - Ownership + binding checks run **before** any `alreadyConsumedView`.
   - Idempotent replay only returns the **owned** CONSUMED row.
   - Same `consume_message_id` on another actor/tenant does **not** leak `partnerId` / result.
2. **#45 class collision**
   - Renamed facade to `PartnerMasterDataService`; Controller injects that type only.

## P1 fixes

1. **`assertCustomerVisible`**: when `jsh_system_config.customer_flag=1`, missing `UserCustomer` assignment **denies** (no global access).
2. **Duplicate-name race**: MySQL `GET_LOCK` around create/rename + `assertNameAvailable` inside the lock.
3. No finance fields via chat (bank/tax/balances rejected).

## Tests

| Test | Result |
|---|---|
| `node deploy/scripts/aierp-021a-partner-phrase-unit.mjs` | **PASS** (typed namespace + bare/material rejects) |
| `node deploy/scripts/aierp-021a-partner-master.mjs` | **27/27 PASS** (evidence `aierp-021a-partner-master.json`) |

Negatives covered: cross-tenant same msgid, cross-sender same msgid, msgid collision fresh commit, bare 确认建档, 确认建档物料, pending partner survives material phrase, customer_flag deny, dup name, wrong type, sensitive fields, rebind invalidate. Stock unchanged.

## NOT_VERIFIED

- Live WeCom DM UAT / F: OpenClaw runtime deploy (explicitly out of scope; light plugin wiring only in repo)
- Production inventory posting (must remain unchanged; automation did not confirm purchase/mix/service)
- Concurrent multi-agent Docker image races during local rebuild (final run used `aierp-boot:021a-review-fix` prebuilt jar image)
