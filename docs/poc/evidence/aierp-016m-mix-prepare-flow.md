# AIERP-016M non-post evidence

- suite: `aierp-016m-mix-prepare-flow`
- pass/fail: **19/0**
- Excel draftId: `130` → phrase `确认配制130`
- Slot draftId: `131`
- businessKey: `MIX-016M-MVJDM39C`
- stock unchanged after prepare: **true**
- LIVE_WECOM_CONFIRM: PENDING_USER (do not auto-confirm; never #119)

## Checks
- PASS phrase_match_plain
- PASS phrase_match_spaced
- PASS phrase_reject_purchase
- PASS phrase_reject_bare
- PASS build_requires_user_recipe
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
- PASS slot_prepare_requires_recipe_flag
- PASS slot_prepare_draft
- PASS slot_prepare_stock_unchanged
