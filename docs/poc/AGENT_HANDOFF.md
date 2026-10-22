# AI-ERP Cursor Agent · 当前唯一 P0：015C 真实回执 PDF 领取与企微发送

**GitHub master**：017B1 PR #35 已 Review/Merge `e3ef4c86`。真实客户企微 2026-10-22 13:35 已将 Excel 80L、¥1600 转为草稿 #119，由用户本人 `确认采购119` → ERP 原生 `GW-PURCHASE-119` 已审核、库存 170.7→250.7 L。不要重新采购、不要重跑 #119 过账。

**当前失败的客户体验**：用户要求“《采购入库业务回执》发我”，Agent 竟调用 `erp_excel_template` 回传采购 Excel，并说“未入库”。ERP 已经存在已审核 PDF 业务回执，发送渠道/意图路由尚未打通。

**当前唯一 RELEASED**：`AIERP-015C`，阅读 `docs/poc/queue/AIERP-015C.md`，从最新 origin/master 独立开 `feat/aierp-015c-wecom-real-receipt-pdf`，不要修改其它 HR/ERP 项目。

1. 优先在可信企业微信原始私聊中识别“发我采购入库回执/PDF/发 GW-PURCHASE-119 回执”，**明确区分与“发采购模板”**；使用本人真实绑定，不准模型猜别人收据。
2. Java 服务端从已有 `aierp_gateway_receipt` 实时查询**已审核**原生单据，当前用户/租户/仓库/WeCom sender/bot/binding_version 鉴权后返回真正 PDF 文件字节；不得模型传路径，不得随意泄露其它 ERP 账户回执。
3. 从已有 Windows native Excel 媒体发送机制复用受控文件发送，实测 PDF 在客户企微客户端收到并能打开。注意发送成功不等于过账，发失败不能重过账。
4. 消息简洁：“已找到采购入库单 GW-PURCHASE-119（80L，1600 元，已审核），这是你的业务回执 PDF。” 如果发送失败：“单据已入库，但 PDF 发送失败，可在 ERP 回执页面下载。” 不得说未入库或送 Excel。
5. 首先在 F: 备份，并从最新 master 进行 **017B1 额外 Java 文件 hash/预览代际/旧草稿取消失败**三项最小回归：跑无过账 017B1 11/11 与 017A 11/11，确认 Java 编译再集成新插件。
6. **用已存在真实 `GW-PURCHASE-119` 测 PDF，不要新建采购、不再增加 80L 库存、不触碰旧 #113。** 脱敏证据和客户端文件打开截图可由用户验证。
7. Push `READY_FOR_REVIEW` + 新 HEAD/测试/送达状态，Cursor 不自行 Merge。017B/C 多场景批量和 019B 动态 API 网关继续排在后面。
