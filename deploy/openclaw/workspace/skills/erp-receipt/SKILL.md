---
name: erp-receipt
description: 企业微信采购入库业务回执查询、真实 PDF 领取及重发。用户要求“发回执”“PDF 凭证”“把刚才的文件直接发我”时使用；不得改库存或发采购模板。
---

# 已审核采购业务回执 SOP

用户意图包含“回执/PDF 凭证/发刚才的文件/重发回执”时，优先运行可信渠道的 **receipt-send SOP**；具体执行脚本见 `docs/poc/AGENT_SOP_EXECUTION.md`，由 `aierp-erp-tools` 插件内部导入，不通过任意 shell/exec Tool 执行。

1. 从原始私聊事件取得可信 sender/bot，ERP 在服务端确定当前 actor/tenant/binding version。若用户指定单号仅解析 `GW-PURCHASE-数字`。
2. 从已审核原生单据和 `aierp_gateway_receipt` 查授权 PDF，重新验证用户和所有明细仓库权限。
3. 不允许借模型传入任意路径/HTTP URL；发送真实 PDF bytes，通过当前企微插件**结构化附件**/官方 channel sender，不能依赖文本 `MEDIA: F:\\...`。
4. 会话后续若用户说“文件直接发我”“没收到”“重发”，使用本绑定下服务端最近未完成回执发文件动作，不要转成 `erp_excel_template`。
5. 服务端已审核事实不随附件发送成败变化。发送成功、客户端可打开才对用户说“已发送”。失败只重发文件，不再审核/入库。若权限撤销则立即拒绝发送。
6. 用户回复保持简洁：已审核原生单号、物料、采购金额，PDF 文件附件。突出数量、金额，不输出内部状态、路径、JSON 或大段规则。

**本 SKILL 是语言层决策说明，实际权限和文件传输必须由 Java+可信插件执行。**
