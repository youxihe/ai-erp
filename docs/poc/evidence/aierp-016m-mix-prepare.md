# AIERP-016M evidence (non-post)

- pass: **true**
- draftId: 243
- businessKey: PZ-016M-MVJTBAMI
- confirmPhrase: 确认配制243
- stock unchanged: true
- GW-PURCHASE-119 untouched: true

## Results
- PASS unit_mix_confirm_phrase
- PASS unit_not_purchase_as_mix
- PASS unit_registry_routes_mix_confirm
- PASS unit_registry_purchase_still
- PASS unit_recipe_ack_phrase
- PASS unit_model_boolean_alone_rejected
- PASS template_mix_3_raw_fg101
- PASS preview_auto_mix_draft
- PASS one_bill_three_raw_lines
- PASS posted_false_on_prepare
- PASS prepare_stock_unchanged
- PASS replay_idempotent_same_draft
- PASS replay_stock_still_unchanged
- PASS refuse_model_boolean_while_excel_draft_open
- PASS reject_purchase_phrase_on_mix_draft
- PASS reject_service_phrase_on_mix_draft
- PASS never_auto_confirm_purchase_119
- PASS final_stock_unchanged_non_post
- PASS refuse_model_boolean_as_recipe_approval
- PASS refuse_prepare_without_recipe_hash
- PASS refuse_prepare_before_recipe_ack
- PASS insufficient_stock_fails_prepare

## UAT
- Automation only prepares unposted MIX drafts; does not run 确认配制 posting.
- Human UAT: upload Excel (1 MIX bill x 3 raw) -> draft id -> DM 确认配制{id} -> verify FG-101 +1L and raw deltas.
- No purchase PDF for MIX; text receipt only.
- Do not auto-confirm GW-PURCHASE-119.
