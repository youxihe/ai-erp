# AIERP-022B intent-unit

- Branch: `feat/aierp-022b-receipt-auto-delivery`
- Base: `origin/master` @ `cf96c8dd`
- Command: `node deploy/scripts/aierp-022b-intent-unit.mjs`
- Result: **ALL_PASS 30/30** (see `aierp-022b-intent-unit.json`)
- Regression: `aierp-015c-intent-unit.mjs` + `aierp-015c-outbound-unit.mjs` **ALL_PASS**

Covered:

- `extractBillNumber` accepts `GW-PURCHASE|MIX|SERVICE-*`
- NEED_CHOICE → bare `GW-MIX-n` routes to `receipt_bill_pick` (not re-confirm)
- Delivery ladder constants `PDF_READY` / `CHANNEL_ACCEPTED` / `CLIENT_OPEN_VERIFIED`
- Media roots: realpath under fixed roots only; outside path denied
- 022A future hooks `PARTNER_*` / `MATERIAL_*` / `BATCH` registered as skip-until-wired
