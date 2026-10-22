# AIERP-016M non-post evidence

- suite: `aierp-016m-mix-prepare-flow`
- pass/fail: **25/0**
- Excel draftId: `224` → phrase `确认配制224`
- Slot draftId: `225`
- businessKey: `MIX-016M-MVJS7EH3`
- stock unchanged after prepare: **true**
- LIVE_WECOM_CONFIRM: PENDING_USER (do not auto-confirm; never #119)

## Checks
- PASS phrase_match_plain
- PASS phrase_match_spaced
- PASS phrase_reject_purchase
- PASS phrase_reject_bare
- PASS build_rejects_model_boolean_without_hash
- PASS build_requires_recipe_hash
- PASS phrase_only_confirm_mix_is_post_path
- PASS binding_claim
- PASS template_mix_3raw
- PASS preview_auto_mix_draft
- PASS prepare_not_posted
- PASS summary_has_confirm_mix_phrase
- PASS summary_no_tech_jargon
- PASS stock_unchanged_after_prepare
- PASS workflow_draft_ready
- PASS reject_purchase_phrase_on_mix
- PASS reject_bare_confirm_on_mix
- PASS stock_still_unchanged_after_reject
- PASS slot_prepare_rejects_model_boolean
- PASS slot_prepare_requires_recipe_hash
- PASS slot_recipe_preview_registers_hash
- PASS slot_prepare_rejects_unknown_hash
- PASS slot_prepare_draft
- PASS reject_service_phrase_on_mix
- PASS slot_prepare_stock_unchanged
