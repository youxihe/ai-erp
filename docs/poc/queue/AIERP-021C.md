# AIERP-021C · 主数据缺失时的业务流程挂起与续办

- **状态**：PLANNED / after 021A + 021B Review/Merge + at least one of 017B2/016M/016S integrated。
- **业务目标**：采购/配制/服务耗料解析发现主数据不存在时，不重复问已确定字段，显示“缺少 XX，是否先建档？”并保存该用户可信业务意图和文件引用。建档完成后**从服务端再次校验主数据、权限、价格/数量和原始 Excel**，恢复同一业务草稿准备阶段，不能直接审核。
- **state**：`workflowId, channel, botId, senderId, ERP actor/tenant, binding ID/version, businessType, originalIntent/validatedSlots, previewId/fileHash/revision, missingEntityKind, masterRequestId, status, TTL`。换绑/超时/新修订失效；确认已完成旧单则标 POSTED，不能新建。
- **三类场景**：① PURCHASE 缺供应商/原料 → 新建后继续关联采购；② MIX 缺原料 → 先建档并让用户核对真实配方，不可自行编配方/入账；③ SERVICE 缺客户 → 新建后继续一张服务耗料单。允许中途“取消/修改/继续刚才业务”且不丢原始数据。
- **确认协议**：`确认建档{requestId}` 仅建主数据；`确认采购/确认配制/确认耗料{draftId}` 才能写库存，两次独立可信原始用户授权，不能把建档同意当过账授权。
- **验收**：新供应商/物料/客户三条流程各自从缺档→新建→恢复原业务；同文件/消息重试无重复记录；退订/换绑后禁止跨会话恢复别人的资料；仅依系统存储，不依赖 LLM 对话记忆。
