# AIERP-020B · WeCom Bot WS capability matrix

Probed installed `@wecom/wecom-openclaw-plugin@2026.7.2` + `@wecom/aibot-node-sdk@1.0.7`.
Live PC/mobile delivery: **not verified in this unit** (SDK source probe only).

| Capability | msgtype | SDK | Installed plugin | before_dispatch | Notes |
|---|---|---|---|---|---|
| markdown | markdown | true | true | plain string only — do NOT embed markdown/HTML expecting color | font color tags info/comment/warning only inside real markdown msgtype |
| template_card.text_notice | template_card/text_notice | true | true | false | horizontal_content_list max 6; card_action required |
| template_card.news_notice | template_card/news_notice | true | true | false | image + vertical_content; unused for purchase P0 |
| template_card.button_interaction | template_card/button_interaction | true | true | false | AIERP-020B: buttons ONLY view/copy confirm phrase — NEVER post stock. Ban jump_list type=3 with confirm phrase. |
| template_card.vote_interaction | template_card/vote_interaction | true | true | false | SDK listed; ERP adapter does not emit |
| template_card.multiple_interaction | template_card/multiple_interaction | true | true | false | SDK listed; ERP adapter does not emit |
| image | image | true | true | false | for table/chart PNG (020C); never MEDIA: path text |
| file | file | true | true | false | 015C path; refuse 📎 F:\ path fallback |
| mixed_inbound | mixed | true | true | false | inbound mixed supported; outbound SendMsgBody is markdown|template_card|media |
| html_font_in_plain_text | text/plain-via-before_dispatch | false | false | FORBIDDEN | Never emit <font> / MEDIA: in before_dispatch replies |

## Button policy

- Safe keys: view_confirm_phrase, copy_confirm_phrase, view_receipt, download_receipt
- Forbidden posting keys (never emit): confirm, confirm_purchase, confirm_mix, confirm_service, post, approve, 入库, 过账, 审核
- jump_list type=3 with confirm phrase is **banned** (would auto-send confirm text).

## Multi-line purchase

- `factsFromConfirm` / `extractPurchaseLines` keep **all** lines.
- Totals = sum(line.allPrice); never first-line-only.
- PURCHASE / MIX / SERVICE confirm routes unchanged (trusted phrase → before_dispatch).
