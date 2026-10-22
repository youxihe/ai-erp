# AIERP-015C · 企业微信真实采购入库业务回执 PDF 查找与发送（客户 Demo P0）

- **状态**：RELEASED / next_order #1，依赖 015B #27、017B1 #35 已合并。
- **分支**：`feat/aierp-015c-wecom-real-receipt-pdf`（从**最新 origin/master**建立）。
- **要解决的真实缺陷**：真人企微采购确认 `GW-PURCHASE-119`，库存 170.7→250.7 L；用户说“《采购入库业务回执》发我”后，模型**错把回执当 Excel 模板**，回复“未入库”并发送 XLSX。现有 ERP 已生成业务回执 PDF，只有通过 session 的 `/aierp/v1/wecom/receipt/pdf`，缺可信企微读 PDF 和附件发送入口。
- **唯一目标**：用户不用手动登录 ERP，私聊说“把刚才那张采购入库回执 PDF 发我”→ 返回真正来自已审核 ERP 原生单据的 PDF 附件，可在企微客户端打开。用户发 `发我 GW-PURCHASE-119 的回执` 同样可按已授权单号获取。

## 0. 首先确认和修正用户意图路由

- 在真正可信原始企微单聊 `before_dispatch` 中，优先检测“采购入库回执 / 业务回执 / PDF 凭证 / 发我回执 / 再发刚才的回执”等 **明确已审核回执请求**，再交给 LLM/Excel 模板 Tool。不能把 `回执` 与 `模板` 混淆。
- 中文结果应简洁：“已为你找到采购单 GW-PURCHASE-119，80 L 表面活性剂，采购金额 ¥1,600，已审核。正在发送《采购入库业务回执.pdf》。” 其中 “正在发送”仅是渠道执行中提示；只有企业微信真正发送成功才说“已发送”。失败说明原因并告知可通过 ERP 已登录页面下载。
- 发送回执不重新创建采购草稿、不重新入库、不修改库存、不修改原生已审核单据；如果找不到回执，就真实回答“暂未找到可访问的已审核回执”，绝不转成采购模板或宣称未入库。

## 1. 服务端可信回执检索（P0）

- Java `AierpWecomReceiptService` 已保存 `aierp_gateway_receipt`：`receipt_id, tenant_id, actor_user_id, draft_id, bill_number, depot_head_id, binding_version, wecom_user_id, receipt_json, text_body, pdf_sha256, pdf_storage_ref, pdf_status, delivery_status`。还存在 `loadPdfBytes(User, receiptId)` 的 **ERP Session 授权 PDF**，必须复用底层原生单据、当前用户/租户状态和每个明细仓库权限重验，**不要重写 PDF 单据事实**。
- 新增仅供我们自己可信企微签名 adapter 使用的受控 `/aierp/v1/wecom/receipt/find` / `/receipt/send-file` 或最少一个 `/receipt/file` 接口：**禁止**模型输入 actor/tenant/userId/botId/Secret/文件路径。身份从已安装官方渠道验证的 bot/private sender context 与后端 resolveBoundContext 获取。
- 当用户未指定单号时，从**本企微发送者及其有效绑定版本**中定位最近一笔 `CONFIRMED` 原生采购回执，**优先刚才 #119 / GW-PURCHASE-119**，但必须以数据库真实顺序为准；有多条候选就简洁列出，不允许臆选。如果指定 `GW-PURCHASE-119`，后端按当前 actor + tenant + sender + binding version + live depot rights 精确检索；禁止模型按共享 ERP 账号读取其他企微用户的已审核单据 PDF。
- 当遇到重新绑定同一企微账号、用户停用/角色撤权、仓库撤权或租户停用，必须拒绝旧代际回执访问；ERP PC Session 查询仍依独立登录权限处理。
- 返回 `receiptId, realBillNumber, text, pdfStatus, mime=application/pdf, sanitizedFileName, actualPDFBytes/hash` 等可信元数据。用户输入字符串只能用于指定合法单号，绝不能成为服务器文件路径或 URL。后端始终按受控持久化 receipt.storage_ref 读取文件，防目录穿越与路径注入；需要校验 sha256 实际文件字节匹配。

## 2. 企业微信 PDF 实际送达（P0）

- 优先复用 **已经真实发送成功的 Excel 文件**安全媒体适配器、`MEDIA:` 白名单文件发送机制；但必须由独立可信原始“回执请求”处理链或最小 `erp_receipt_file` **只读专用 Tool** 启动，并能确认它**不会**被误替换为采购 Excel 模板。必要时用 official SDK 受控 channel 发送 API，先检查当前安装版本，禁止虚构 api 方法。不要给 Agent shell/任意文件系统/任意 HTTP。
- 回执 PDF 写入受控临时目录，可用不含 WeCom 用户标识的文件名 `采购入库业务回执_GW-PURCHASE-119.pdf`；清理 TTL 与路径限制，响应限流和文件大小限制。
- PDF 单据由服务端 jshERP 真实已审核单生成，模型不重新排版假凭证。若 PDF 已生成但无法用企微发送，返回准确 `PDF_DELIVERY_NOT_VERIFIED`，提供已登录 ERP 的下载替代路径，不把 localhost 链接发给手机。
- **送达状态**：`PDF_GENERATED` ≠ `PDF_SENT_VERIFIED`；Bot SDK 返回发送已接受也不等于用户收到，客户端实际收到并可打开才算验收。发送失败单独重试文件，**绝不再次过账**。重复“发回执”只能回同一真实账单回执，库存不再次变化。
- 检查商业化 iText 5 许可证可用性；如需替换 PDF 组件可以独立列技术债，不能让许可证问题导致发假回执。不要在 Git 添加字体文件。

## 3. 文案：脱离开发状态与技术名词

- 用户问“我支持什么功能”，可以简洁表述“查库存、采购/配制模板、Excel 核对、采购确认入库、查看/领取入库回执”。不要展示 Tool 名、HMAC、excel.confirm、各阶段编号。
- 用户说“发我回执”不应该收到“采购入库模板已生成、未入库”。原生已审核必须如实表述。PDF 未到达时不要声称已发出。
- 单据日期、物料单位、金额清楚；不要把 PDF 回执写成发票。

## 4. 验收

- 真实企微私聊通过 **`GW-PURCHASE-119` 已审核历史单据**请求文件，**不要新增/审核/更改任何草稿**。服务端找到对应 receiptId 和原生单据、当前权限通过 → 企微实际返回 PDF 文件 → 用户客户端打开，内容为 RM-A001 80 L / 华东化工 / 原料仓 / ¥1,600，库存不变。
- 负例：共享 ERP 登录下另一企微发送者、另一租户、停用用户/撤仓库权限、换绑同秒、无真实回执、伪造 receiptId/billNo/path、群聊请求、非 PDF 文件替换；全部拒绝读取 PDF。
- 重复索要同一 PDF 不再生成原生采购单，文件下载/sha 和真实单据一致，发送失败可安全重试；兼容 13 个模型工具、单张 015B 真实确认钩子及 Excel 入站预览，不覆盖 F: 共享插件。
- 先非入账自动化/Java CI，随后由用户本人在企微真实发“把 GW-PURCHASE-119 的采购入库业务回执 PDF 发给我”；Cursor 提交 `READY_FOR_REVIEW`、HEAD、脱敏测试、客户客户端真实附件 UAT 标记，绝不自行 Merge。

**重要**：015C 不是“生成一个 PDF 样例”任务，目标是**真正把已存在、已审核、用户有权读取的回执 PDF 发到企微会话**。
