# AIERP-016M evidence (non-post)

- pass: **true**
- draftId: 129
- businessKey: `PZ-016M-MVJDLS5I`
- confirmPhrase: `确认配制129`
- stock unchanged: true
- GW-PURCHASE-119 untouched: true

## Results

- PASS unit_mix_confirm_phrase
- PASS unit_not_purchase_as_mix
- PASS unit_registry_routes_mix_confirm
- PASS unit_registry_purchase_still
- PASS template_mix_3_raw_fg101
- PASS preview_auto_mix_draft
- PASS one_bill_three_raw_lines
- PASS posted_false_on_prepare
- PASS prepare_stock_unchanged
- PASS replay_idempotent_same_draft
- PASS replay_stock_still_unchanged
- PASS insufficient_stock_fails_prepare
- PASS reject_purchase_phrase_on_mix_draft
- PASS never_auto_confirm_purchase_119
- PASS final_stock_unchanged_non_post
- PASS refuse_unconfirmed_recipe

See also `aierp-016m-mix-prepare-flow.json` (19/19) and `aierp-016m-ready.md`.
