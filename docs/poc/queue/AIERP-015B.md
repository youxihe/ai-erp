# AIERP-015B · 企业微信可信确认、原生采购入库与业务回执/PDF

- **状态**：RELEASED / next_order #1（依赖 AIERP-015A PR #24 已合并 `1a82abca`）。
- **分支**：`feat/aierp-015b-trusted-confirm-receipt`（**最新 master**）。
- **目标**：用户在企微完成采购草稿后，只需本人明确回复“确认采购{草稿号}”或在唯一待确认草稿场景下回复“确认”，服务器独立验证身份/挑战和业务版本，执行真正 jshERP 采购入库审核，返回原生单号、数量/金额、实时库存，并发送业务回执/PDF。
- **前提**：OpenClaw Windows native `F:\aierp-openclaw` 运行有效，插件 12 工具；不要重装、升级或破坏现有企微 WS。
- **文档**：`docs/poc/adr/AIERP-014D-conversational-confirmation.md`、`docs/poc/14d-api-contract.md`、`docs/poc/15b-receipt-contract.md`。

## 0. 用户交互目标（P0）

收到真实 DRAFT 后，企微提供完整中文采购摘要和“待确认、未入库”状态，建议回复“确认采购106”或“取消106”（单一待处理草稿才允许回复“确认”）；后端必须知道用户正在确认**哪张**草稿。**单纯 LLM 理解文字“确认”不构成过账证据**。

成功后自动回复：

- “采购入库成功 / 已审核”，原生 ERP 单号、物料、数量、供应商、仓库、金额、处理时间、库存前后；
- “采购入库业务回执 PDF”附件，若当前 WeCom Bot 文件发送能力受限，则消息先给完整文本回执，同时生成已登录 ERP 可下载的 PDF。不能以本机 127.0.0.1 链接假装远程手机可打开。
- 出错/权限不足/库存或明细更新：不产生已审核单据、不改变库存，解释原因，支持重新发起确认。

## 1. 实际可信确认通道（P0，先探针）

- 在本机已安装的 `@wecom/wecom-openclaw-plugin` 与当前 OpenClaw SDK 中追踪 Bot WebSocket → 原始消息 → Agent dispatch 的真实调用链。重点验证 `api.on("before_dispatch")` / `message_received` / 官方 WS channel adapter 能否取得**已认证的 from.userid、chatType 单聊、原始文本、消息 ID**，以及这些值是否在 LLM 之前可被适配器消费；以**实际安装版本源码/脱敏日志/测试**为准。
- 推荐独立可信 inbound handler 提前识别明确确认意图后直达 Java 授权适配器；没有可靠原始事件就**不允许**基于模型 Tool 的“用户已经确认”去调用任何过账接口。Hook 只观察时不得假定具备阻断能力。
- 不允许因用户引导而放开官方 `wecom-cli` 的全部企业业务工具权限；以我们自定义插件的最小能力提供确认事件侧入口。
- POC 对话可省略额外手输随机 PIN，但**服务端必须有一次性高熵挑战、草稿唯一匹配、经过验证的发送者及原始消息、限时限次、messageId 去重**；只有一个有效草稿时可接受“确认”，否则必须指定草稿号。单据已过账后的重复事件只返回已有单号，不二次入库。
- 如果 SDK 无可靠原始事件/独立确认钩子：报告 `BLOCKED_TRUSTED_CONFIRM_EVENT`，保底用已登录 ERP PC/H5 提交确认并发送企微回执。**绝不生成假的已入库成功消息**。

## 2. 绑定所有权修复（P0）

- 015A 的草稿 `binding_bound_at` 在秒级截断，解绑后**同一秒重新绑定**可能出现相同标识。引入不可复用的 binding generation（数据库单调递增 `binding_version` 或唯一随机 generation），在 ERP 服务端每次认领/重绑定原子更新。
- 采购草稿、确认挑战必须绑定 `channel + botId + wecomUserId + ERP tenant/user + binding generation + draftId + draftVersion + payload hash`；解绑后旧草稿状态可归档但不可按新绑定继续确认。
- 开发数据库 schema migration 有幂等/版本检查，避免已应用 `06` 脚本重复执行失败。

## 3. 原生真实过账（P0）

- 对 `AierpGatewayService.confirmInTx`、`postNativeBill`、`DepotHeadService.addDepotHeadAndDetail`、`batchSetStatus`、`UserService.getCurrentUser` 等所有相关下游做**完整调用链审计**。**不允许伪造 ERP HTTP Session、RequestContextHolder/ThreadLocal、Cookie 或使用管理员长期 Token**。
- 首选 Java `confirmAs(VerifiedActor, draftId, confirmationProof)`，把明确的绑定 ERP actor 用于原生单据创建、审核、租户过滤及审计，复用现有事务、库存行锁、幂等锁和单据号 `GW-PURCHASE-{draftId}`；如果原生服务无法安全消除 Session 依赖则**不启用企微直接过账路径**。
- 替代方案：ERP **已登录** PC/H5 的授权员工查看本人草稿并确认，服务端仍核对企微草稿所有权、版本、数量、金额、角色审核按钮、仓库/租户/供应商/物料等，采用原有 authenticated session 原生提交，不冒充其他用户。复杂性不可转移给模型。
- 确认必须有一次性挑战事务消费/幂等键；在数据库同一事务防止重复原生已审核单据，即使两个重复入站事件并发，也只有一张已审核单号。确认成功前后库存真实快照需校验；失败不能误写成功/已收讫。
- 禁止直接操作 `jsh_material_current_stock` 或绕过原生 ERP 扣加库存；测试需验证可从原生 ERP 页面查询到该审核单据及变更。

## 4. 回执和 PDF（P0 文本、P1 PDF 真实文件）

- 精确定义和落实 `docs/poc/15b-receipt-contract.md`：回执由服务器根据**真实 `CONFIRMED` 的原生 ERP 单据及明细**构造；不能让 DeepSeek 直接决定单据号/金额/库存变化或制作缺乏对应真实单据的 PDF。
- PDF 中文渲染必须字体可用且没有乱码、表格溢出。优先复用项目依赖/后端现有报表能力，核实字体/许可证；生成后通过实际渲染预览检查（A4 纵版单页或合理分页）。仅标“业务回执/采购入库回执”，**不得标“增值税发票”或“付款证明”**。
- 由 ERP 私有文件存储生成 `receiptId`、`billNumber`、`sha256` 和下载授权；仅对应用户/租户有权读取，用户可以“查看回执”重复获取同一账面凭证，不能每次生成不同业务事实。
- 企微官方 Channel 的文件消息/附件发送能力要实际验证：能发 **PDF 文件并被用户企业微信客户端打开**才记 `PDF_SENT_VERIFIED`。如不支持，回执文本 + ERP 受控下载是完成 P0 的保底，但需标 `PDF_DELIVERY_NOT_VERIFIED`，不能仅凭服务器生成 PDF 就说“已发送”。

## 5. 验收/禁止

- 正向真人企微**独立测试草稿**：提采购 → ERP 真 DRAFT → 用户私聊原文确认 → 审核入库 → ERP 原生单据/时间/金额/创建人一致 → 库存严格 +10 L → 回执文本 → 企微 PDF 文件（P1）；
- 反向：没有原始 WeCom 事件、只是 LLM Tool 自填“已确认”、群聊转发、不同发送者、不同 ERP 用户/租户、换绑同秒、挑战过期/取消/修改、权限中途撤销、重复投递与并发两次、服务重启后重复确认，均不得形成第二张单据或泄露回执；
- 每一项区分：服务器静态/脚本 PASS、真实企微确认 UAT PASS、原生单据&库存 PASS、PDF 生成 PASS、PDF 私聊送达 PASS；
- **不得无提示自动过账已存在的 #106 或任何用户真实草稿**：首次写入测试要创建专门测试 DRAFT 并由用户本人明确发确认，保留真实单据与库存证据。必要时让用户先确认授权测试数据变化。
- 双真人企微/两个不同仓库角色 UAT 若仍未完成，标 `NOT_VERIFIED`，不得宣称生产多用户权限完备。
- 不接新公网、不开群聊写操作、不改其他 HR/HCM 栈；Cursor Push `READY_FOR_REVIEW` + 新 HEAD + 脱敏证据，ChatGPT 独立 Review/merge。
