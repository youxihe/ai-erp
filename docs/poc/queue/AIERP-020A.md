# AIERP-020A · 标准业务 SOP 脚本与企微业务消息渲染（Agent 2.1）

- **状态**：RELEASED / next_order #2 (docs/design and independent runtime work; **do not deploy to F: until PR #37 015C media delivery is integrated and no regression**)
- **代码分支**：`feat/aierp-020a-sop-business-message` from newest origin/master **after 015C merge**, or preparatory docs-only independent branch while #37 blocked.
- **使命**：不要依靠长篇 AGENTS.md 或 LLM 逐步解释标准流程；让确定性的 Java/JS SOP 有明确输入输出、可信身份、状态机、幂等、异常处理；OpenClaw 负责意图/槽位，标准流程服务端执行，业务消息由模板渲染。

## 已优先落地的脚本/流程

| 类型 | 入口与触发 | SOP 脚本/模块 | 服务器业务事实 | 允许结果 |
|---|---|---|---|---|
| 查库存 | 用户问某物料当前库存、仓库、条码 | `sop/stock-query.mjs` | ERP 已授权库存 API | 只读，按仓列数量单位 |
| Excel 采购 | 要 Excel 模板/预填 → 回传 Excel → 预览 | `sop/purchase-excel.mjs` | ERP 物料/供应商/授权仓/previewId | 真 XLSX → 真实未审核 draftId，不审核 |
| 采购确认 | 可信原始私聊 `确认采购{数字草稿号}` | `sop/purchase-confirm.mjs`（迁移现有 before_dispatch） | 015B Java 原生采购审核、库存事务 | 已审核业务单和回执；绝非模型 Tool |
| **采购回执** | `发回执`、`发GW-PURCHASE-119回执`、紧接 `文件直接发我` | **`sop/receipt-send.mjs`** | 015C 当前 actor/tenant/binding generation/授权仓 + 已审核单 + pdfHash | 真实 PDF 企微文件消息，绝不是 MEDIA 文本 |
| 配制/耗料 | 配制/组装、服务耗料 | 待 016/017B 支持后延伸上述脚本约定 | 原生 ERP MIX/SERVICE | 先受控草稿/预览，再可信确认（后续） |

**本棒只需先重构当前已跑通的库存/Excel 采购/回执及可信确认**；MIX/SERVICE 正式写业务尚未完成，SOP 要标真实能力状态，不能夸大。

## SOP 代码实现约束

1. 使用 `deploy/openclaw/sop/` 目录的可导入 JS 模块，不做 shell 或任意文件执行 Tool。由已安装 `aierp-erp-tools` 可信插件注册原文路由/只读工具并调用，**不是**把 `scripts/*.mjs` 的 OS 执行权限交给 LLM。禁止 LLM 传任意 API URL/SQL/文件路径。
2. 每个 SOP 有明确 `canHandle(intent, trustedEvent)`、`run(verifiedContext, validatedArgs)` 和 `render(result, channelCapabilities)` 接口，输入严格 Schema 验证；Java ERP 端每次独立 revalidate 绑定、角色、租户、仓库；模型只获得可见的业务摘要。
3. 提供 `SOP_REGISTRY` 优先级：`receipt_request/receipt_followup` > `purchase_confirm` > `file_attachment` > `file_cancel` > `purchase_excel` > `stock_query` > `fallback_llm`；避免 **发回执 → erp_excel_template**。精确确认文本独立于模型优先处理，但不得让泛化“确认”错误审核另一草稿。
4. `pendingAction` 必须 server-authoritative：以 bot + 可信 sender + binding ID/version + actor/tenant 为作用域，记录 receiptId/billNo/fileHash/status/TTL；随后 `文件直接发我`、`重发`、`刚才那个` 必须延续已验证回执。更改绑定立即失效；不得使用模型上下文推断权限。
5. **文件输出**：使用 OpenClaw / WeCom 当前安装版本的**真实结构化媒体发送**或受控官方 SDK（白名单 mediaLocalRoots），不能让 before_dispatch 返回文字 `MEDIA: C:\\...`。区分 FILE_READY / SEND_ACCEPTED / SENT / CLIENT_OPEN_VERIFIED；发送失败只重试媒体，严禁重新过账。
6. `AGENTS.md` 保持短小：角色、当前真实可用能力、意图→SKILL/SOP 映射、可信确认、不允许动作；具体异常/示例移到每个 `SKILL.md`，减少 token 消耗与每次对话说教。
7. 统一 `formatBusinessReply(result, capability)`。根据本机实际 Bot WS 的 Markdown/卡片支持决定是否启用彩色，支持就用企业微信有限的 `info/comment/warning` 颜色，不能把 HTML/Markdown 标签当普通文本发送。业务主数据用清晰标题、粗体金额/数量、状态、少量行间距；不输出 JSON、6 位小数或路径。

## 验收
- 最优先用户真实问题：`发 GW-PURCHASE-119 回执` → **收到并能打开**与 ERP 原始单匹配的 PDF；后续 `文件直接发我` → **同一份 PDF**，不能变成 Excel 模板。
- 采购入库一条标准成功消息 4-6 行；低权限失败 1-2 行，不能说未入库，也不能发附件路径；同一用户不同会话、/new 不丢已审核状态。
- 内容样式通过真实企微 PC/移动端截图验收，提供 plain-text 降级效果；不得宣称可选择任意字号/颜色（受企微 Markdown/Card 限制）。
- 不新增库存变化测试；回归 015B trusted confirm、017A Excel 真实文件、017B1 one-confirm purchase and 13 tool bindings。CURSOR PUSH → ChatGPT Review → Merge，不能自 Merge。

## 2026-10-22 · 三类业务复用 SOP 与渠道 renderer

新业务 SOP：`purchase-batch-prepare`（多单采购，仅 DRAFT）、`mix-prepare`（组装配制）、`service-consume`（客户服务耗料）。每个 SOP 输入必须是服务端已授权 normalized 业务数据并复核权限；模型只做业务意图/槽位选择，正式过账必须独立可信企微原始消息。

**渠道渲染分开**：推荐 `renderBusinessResult(result, channelCapabilities)` 工厂分派，`wecom` 严格依据实际 Bot WS markdown/card/plain 能力，`feishu` 将来按飞书 interactive card/schema 单独实现。**不能**在企微文本里混入飞书 JSON/Card 结构或 literal `<font>`。业务标准消息突出 ERP 单号、状态、数量、金额、仓库、客户和真实回执文件；失败只指明业务原因和下一步。批次消息展示各子单处理状态与部分成功，不得把单据数/不同单位简单求和。
