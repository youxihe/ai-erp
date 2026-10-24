# AI ERP — 渠道原生富消息 / 表格图表 / 审计 PDF 架构（2026-10-24）

## 现有源码与平台事实

GitHub master 当前 633e3de5；F: Windows OpenClaw 运行态尚未直接验证。企业微信官方 WecomTeam/wecom-openclaw-plugin / aibot-node-sdk 支持 Bot WS Markdown、模板卡片 text_notice/news_notice/button_interaction 等、图文混排、图片、真实文件。当前 F: 安装版本/API/PC 手机呈现均需实际探测，不能把 plain before_dispatch 中的 HTML 字体标签当真卡片。

目前 wecom-business.mjs 以纯文本为主，采购 factsFromConfirm / renderPurchaseConfirmed 多用 first line，导致多商品、单价、总额不能完整呈现。AierpWecomReceiptService 仅 PURCHASE PDF；MIX/SERVICE 为文字回执；refreshPdfLayout 原路径覆写已生成 PDF/sha，损伤历史凭证一致性。主数据写入 #44/#45 仍未合并。

## 权威业务数据 → 选择展示组件 → 渠道发送

ERP 原生授权结果 → BusinessResult 结构化 DTO（schemaVersion、operationId、bizType、status、tenant/actor、sourceRefs、nativeBill、lines 每行名称/编码/数量/单位/单价/金额、stockChanges、metrics、columns+rows、series、receiptIds）→ 白名单 render_plan → 渲染器 → channel adapter。

渲染库：
- card.status / card.purchase_lines / card.mix_materials / card.service / card.error：真实卡片/Markdown（能力测试通过才启用）；
- table.basic / table.grouped：带表头/金额/单位/合计/分页的 PNG 表格图片，大量数据另发 XLSX；
- chart.bar_compare：至少两个同量纲类别；chart.line_trend：有真实时间轴和三个以上时间点；
- chart.pie_share：同分母、全非负、2–6 分类且份额和验证；chart.delta_before_after：原料/成品/库存前后变化；
- file.pdf_operation_receipt / file.xlsx_export：单独真实文件消息，不将 Windows 路径写入回复。

OpenClaw 只选择允许的模板 ID、已有 ERP 数据集引用及轴/字段白名单；不能自行编数字，不接收任意 HTML、JavaScript、SQL、外部 URL、本地路径。图表按已授权查询/聚合的结构化数据渲染，不能把模型推断当事实。不同单位/币种不求和，负数不可做饼图，时间排序与范围明确，空数据降级为表格。标题、单位、范围、来源、生成时间和 alt 文本不可缺失。

企业微信：实测官方 Bot WS 的原生 card、markdown、image、file 发送，图表/复杂表格输出 PNG。飞书：单独 card schema，绝不直接把企微 Markdown/卡片 JSON 复制过去。通用语义 DTO 才能共享。渠道样式突出商品名称、数量、单价、每行金额、总金额及状态，图片配色可以细控但企微原生卡片的字体颜色受 SDK 限制；中文字体不得提交 Git。

## 所有 AI ERP 真实写入操作留档

本轮范围：OpenClaw 发起的采购入库、配制生产、服务耗料、批次确认、客户/供应商/物料主数据 CREATE/UPDATE 和取消等写操作。ERP 后台/其它外部入口的全站审计另行接入，不在本轮假称覆盖。只读查询记访问日志，不强制每查一次发 PDF。

审计 append-only 业务操作流水：tenant、ERP actor、bot+sender+bindingId/version、可信原始 msgId、traceId、operationId、canonical input hash、目标单据主键/原生单号、执行状态、reason、before/after/stock movement、时间、凭证版本/sha、出站投递阶段。重要原生提交与审计/outbox 应保证一致或可补偿；重复操作记 REPLAY_NOOP，不改库存。

成功写操作生成准确的 PDF 回执：PURCHASE_IN、MIX、SERVICE_CONSUME、PARTNER_CREATE/UPDATE、MATERIAL_CREATE/UPDATE、BATCH_PURCHASE、DRAFT_CANCEL 使用独立标题和字段；MIX 同时列原料减少与成品增加，SERVICE 列客户/仓库/服务项目，主数据更新列授权白名单字段修改前后差异。PDF 明确“业务操作回执（非发票）”；失败审计不能冒充已审核单据。

PDF 生成后存 immutable 文件、layoutVersion、sha256，不覆写既有 PDF；升级版式新建版本、保留旧件与 hash，真实授权状态及仓库/客户权限每次下载重校验。PDF 生成失败可独立补偿但绝不重新过账。成功后由现有 WeCom media adapter 自动发真实 PDF；生成成功、上传接受、送达、客户端打开是不同状态，失败只能重发文件。每个批次逐单 PDF + 汇总 XLSX/PDF，PARTIAL_SUCCESS 逐项准确报告。

## 当前工作顺序

1. Deploy Agent：验证 Boot jar hash 与 F: plugin git head /版本 manifest，不能凭 Gateway 200 声称最新发布。
2. 020B 企微原生卡片、业务明细和渲染能力实验；020C 表格/图表通用组件；两者可独立并行。
3. 022A 全写入审计与不可变 PDF（优先 MIX/SERVICE + PURCHASE 历史兼容）；022B 自动发送与重发。
4. 保持 017C1 批次入库、#44/#45 主数据并行开发，不抢占单一部署窗口。
