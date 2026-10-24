# AIERP-022A · 全业务写操作审计 + 不可变 PDF 操作回执

状态：RELEASED / audit P0。分支：feat/aierp-022a-unified-mutation-audit-pdf，从 master，后端为主。
当前代码采购 PDF 基本可用，但 MIX/SERVICE 仅文字回执，主数据 #44/#45 待合并；AierpWecomReceiptService.refreshPdfLayout 会在旧路径覆写 PDF/hash。必须先修 immutable 版式版本，不再擦掉已经送达的历史字节证据。

所有通过 AI ERP/企微产生的真实写操作（采购、MIX、SERVICE、批次过账、供应商客户/物料 CREATE/UPDATE、草稿取消）都留有服务端追加的 audit event、独立凭证与可下载 PDF。每次已成功原生入账单或主数据实际落库才标 COMMITTED/POSTED；失败/拒绝也留审计但不伪造完成回执。只读查询审计访问，不强制 PDF；后台其它直接写入源是后续扩展，不误报已覆盖。

复用 aierp_gateway_receipt，新增向后兼容的 audit event / versioned receipt storage/outbox schema：trace/msg/bot/sender/ERP actor/tenant/binding generation/action/canonical hash/beforeAfter/natural key/真实 native bill/状态/PDF layoutVersion/sha256/delivery 状态、时间；禁止暴露敏感客户原文和密钥。存储写入与 native ERP 事务要一致或具备可恢复补偿；replay 不重新审核。

独立模版 PURCHASE_IN/MIX/SERVICE_CONSUME/PARTNER_CREATE|UPDATE/MATERIAL_CREATE|UPDATE/DRAFT_CANCEL/BATCH；本棒先保证 PURCHASE 历史不回退、MIX 原料扣减与成品增加、SERVICE 客户出库真实单据与库存变更均有准确独立 PDF，绝不用采购标题冒充。每行实际数量/单位/金额/仓库/前后库存、操作人时间审计号；业务操作回执不等于发票。主数据等 #44/#45 通过后接入统一钩子。

验收：已有 #119 只读 PDF 仍有原审计版本，不能重过账；已存在 MIX/SERVICE 原生已审核历史单可只读生成正确 PDF；PDF 原 SHA 不覆写，版式升级创建版本并保留旧件。不同租户/撤权/换绑/仓库权限拒绝下载。生成故障只重试 PDF，不影响真实 ERP 成功事实。Java BUILD + nonpost 回归+脱敏 PDF/sha/真实原生单号证据。
