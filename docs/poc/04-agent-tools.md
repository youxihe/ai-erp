# AIERP-004 · 规则演示助手

`POST /jshERP-boot/aierp/v1/assistant/turn`

没有配置大模型密钥。响应里的 `mode` 固定为 `RULE_DEMO`。库存和草稿调用已合并的 ERP 网关。这个控制器不会调用 `draft.confirm` 或 `excel.confirm`。

Excel 模板在独立分支，未合并前助手明确返回待接入，不生成假的 xlsx。
