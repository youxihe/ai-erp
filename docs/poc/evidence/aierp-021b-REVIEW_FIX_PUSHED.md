# AIERP-021B REVIEW_FIX_PUSHED

- **Ticket**: AIERP-021B (PR #45 material masterdata)
- **Branch**: `feat/aierp-021b-material-masterdata-sop`
- **Status**: `REVIEW_FIX_PUSHED`
- **Remote HEAD**: `38eae8e725ef194ddcaa551067ee25fe98c2fed5`
- **Scope**: ChatGPT Round 1 REVIEW_FIX only (no merge, no F: overwrite, no stock/initStock writes, did not touch #44 / `PartnerMasterDataService`)

## Coordinated naming (vs AIERP-021A / PR #44 @ 7acd8008)

| Item | Chosen value |
|---|---|
| Java class | `MaterialMasterDataService` (mirrors `PartnerMasterDataService`; **not** shared `AierpWecomMasterDataService`) |
| Confirm CREATE | `确认建档物料{requestId}` |
| Confirm UPDATE | `确认修改物料{requestId}` |
| SOP registry key | `material_confirm` |

Rejected / must not collide with partner:

- bare `确认建档{id}` / `确认修改{id}`
- `确认建档供应商{id}` / `确认建档客户{id}` (021A)
- alternate order `确认物料建档{id}` (not used)

## P0 fixes

1. **Write permission**: `prepareMaterial` and `commitMaterialAs` both call `assertMaterialPermission` (RoleFunctions funId=23「商品信息」). Low-permission bound user prepare → 403.
2. **eventSource**: commit requires exact `WECOM_BEFORE_DISPATCH`; null/empty/LLM self-report → 403. Independent binding / wecomUserId / botId / tenant checks; group chat rejected.
3. **Integration split**: distinct `MaterialMasterDataService` + namespaced confirms so partner phrases cannot commit material ids (and vice versa).

## P1 fixes

1. **Barcode race**: MySQL `GET_LOCK` + `FOR UPDATE` re-check inside create path; flow asserts exactly one winner.
2. **Zero stock**: create path never inserts `jsh_material_current_stock` / `jsh_material_initial_stock`; post-check counts must be 0 for every warehouse.
3. **No historical bill mutation**: update whitelist is name/standard/brand/remark only; bar_code / base unit / depot_head / depot_item untouched.

## Changed files (this push)

- `jshERP-boot/.../MaterialMasterDataService.java` (new; replaces `AierpWecomMasterDataService`)
- `jshERP-boot/.../AierpWecomController.java` (inject MaterialMasterDataService)
- `deploy/openclaw/sop/material-upsert.mjs` + plugin copy (namespaced `MATERIAL_CONFIRM`)
- `deploy/scripts/aierp-021b-material-master-flow.mjs` (low-role / null eventSource / cross-binding / race / zero-stock)
- `deploy/scripts/aierp-021b-material-phrase-unit.mjs` (offline phrase namespace)
- docs: queue / ready / this evidence

## Automation

| Test | Result |
|---|---|
| `node deploy/scripts/aierp-021b-material-phrase-unit.mjs` | PASS (offline) |
| `node deploy/scripts/aierp-021b-material-master-flow.mjs` | **NOT_VERIFIED** (local ERP `127.0.0.1:9999` unreachable at push time) |

## NOT_VERIFIED

- Live HMAC flow against rebuilt `aierp-boot` (ERP down at push)
- Live WeCom DM UAT / F: OpenClaw runtime deploy (explicitly out of scope)
- Production inventory / stock (must remain unchanged)
- Concurrent barcode race under production load (code + flow cover local dual-commit)

---

**Exact remote HEAD after push**: `38eae8e725ef194ddcaa551067ee25fe98c2fed5`
