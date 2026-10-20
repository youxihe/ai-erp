# AIERP-015B · 可信采购确认与原生 ERP 实际过账

- **状态**：PLANNED / NOT RELEASED（依赖 AIERP-015A 真实草稿通过 Review，并完成确认通道可验证性及原生 actor 调用链审计）
- **目标**：在已有真实草稿上，通过可信企微原始私聊事件/官方卡片回调，或用户实际登录的 ERP PC/H5 页面点击确认，由 Java 服务器重查当前用户/租户/仓库/角色权限并单次调用既有原生 `draft.confirm`，库存方向正确且重复提交幂等。
- **硬条件**：任何 OpenClaw 模型 Tool 都不能拥有单凭自填 `draftId` 即过账的权限；禁止共享管理员账号、伪造 Redis/HTTP Session；采用显式身份 actor 与审计来源，现有下游 Session 依赖全数消除前只允许 ERP 登录页面确认。
- **失败处理**：错误单位、供应商无效、库存不足、权限中途撤销、挑战码过期或跨用户都拒绝；重复确认只返回原单号不重复库存变化。
- **本任务不自动认领**。具体 Release 由 ChatGPT 在 015A Review 后执行，完整设计见 `docs/poc/adr/AIERP-014D-conversational-confirmation.md`。
