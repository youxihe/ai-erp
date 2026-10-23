# AIERP-016M evidence (non-post)

- pass: **true**
- draftId: 301
- businessKey: PZ-016M-MVJWQDDR
- confirmPhrase: 确认配制301
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
- 自动化仅准备未审核 MIX 草稿，未执行「确认配制」过账。
- 真人 UAT：上传同配制单号 3 行原料 Excel → 得草稿号 → 本人私聊「确认配制{id}」→ 核对 FG-101 成品仓 +1L 与原料扣减。
- 禁止用采购 PDF 冒充配制回执；配制回执以文字为准（无 MIX 专用 PDF 模板时）。
- 勿自动确认 GW-PURCHASE-119。
