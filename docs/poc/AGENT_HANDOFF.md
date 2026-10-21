# AI-ERP Cursor Agent · PR #24 最小 Review Fix

只操作 `youxihe/ai-erp`。当前 OpenClaw 为 `F:\aierp-openclaw` Windows native，严禁重装/升级，也不可碰 HR 项目。

**当前重要事实**：
- PR #21 AIERP-013 **已合并**（`8251b7e`）：4 个既有 ERP 工具 + 5 个只读业务查询工具，混合仓金额跨仓权限 23/23 通过。
- PR #22 014D **已合并**，可信确认协议已冻结；**015B 未 RELEASED**。
- PR #24 AIERP-015A（`e441e4d1`）**REVIEW_FIX_REQUIRED**：Java 明确的 `createDraftAs(boundUser)`、真实数据库 DRAFT、库存不变 14/14 本地 PASS；但企微实测说当前 Session 不含 `erp_purchase_prepare`，从旧 master 开发的插件配置丢失 013 五个查询工具。

**立即操作**：
1. 读 PR #24 ChatGPT Review 评论，原分支 `feat/aierp-015a-purchase-dialog-draft` 同步最新 `origin/master`，谨慎合并 013 和 015A 两侧 OpenClaw 源码、配置、workspace 指令，**全量 12 个指定 Tool**；不覆盖本控制面 `013 DONE`、`014D DONE`、`015A REVIEW_FIX_REQUIRED`。
2. 草稿状态/取消必须严格限定可信 `channel + botId + wecomUserId + binding epoch` 所有权，不仅检查 ERP tenant/user；同 ERP 登录的另一个企微用户不可猜草稿 ID 读取/取消。加合成双身份/换绑 fixture；不修改真实库存。
3. `createDraftAs` 幂等 replay 已处于 CONFIRMED/CANCELLED 状态时不能伪称 `posted=false/stockUnchanged=true`；结果须以真实状态为准或明确拒绝。
4. F: 运行时先备份插件、`openclaw.json`、`AGENTS.md` 再更新，验证 Gateway 实际注册并开放 12 个工具；新/刷新企微对话实际能调用 `erp_partner_search` 和 `erp_purchase_prepare`（不是只看 HTTP 200）。
5. 用户“沿用之前那家供应商”要先用实际授权 ERP 采购历史核实；无法证明时列候选或追问，不能靠 LLM 记忆填充。
6. 无过账证据、新 HEAD、最小企微实际 DRAFT 截图 → `REVIEW_FIX_PUSHED`，由 ChatGPT 决定合并，Cursor **不自行 Merge**。

**安全闸门**：无 `erp_draft_confirm`，不造假 Session/管理员 Token；015B 依赖 015A 通过后才可单独 Release。双真实用户仓库权限 UAT 仍 NOT_VERIFIED。
