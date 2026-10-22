# AI-ERP Cursor · 2026-10-22 14:25 最新优先级：015C 真实 PDF 发送 + SOP 代码化与业务消息美化

当前已合并 `AIERP-017B1`：企微本人确认 **GW-PURCHASE-119** 已审核、RM-A001 80 L、¥1600，库存 170.7→250.7 L，禁止再过账。

**目前 PR #37 015C `REVIEW_FIX_REQUIRED`**，HEAD 初始 `55bf5bcd10b4...`，最新 ChatGPT Review 正文必须先读。**截图证据**：企微回执只是出现本地 `MEDIA: F:\\...pdf` 文本，并没有 PDF 附件；用户说“文件直接发我”，竟走到采购模板 Excel。不能把 8/8 意图测试或 PDF_GENERATED 算真实发送。

## 第一棒（原分支立即修复，不另开大 PR）

1. PR #37 原分支 `feat/aierp-015c-wecom-real-receipt-pdf`；读取官方 OpenClaw hooks/media 规范和 **F: 本机当前已安装官方 WeCom 插件的实际代码/版本**，核对出站文件 API 与 `mediaLocalRoots`。
2. **不要继续 from before_dispatch 返回 text 里面的 `MEDIA:`**。改为真正可交付的 WeCom 结构化 media payload 或受控官方渠道 send，出站能生成 **PDF 文件消息** 并在客户端可打开。必须保证当前绑定 sender/actor/租户/仓库/企微绑定版本的重新校验。不能暴露任意文件系统 Tool，不能把 F: 整盘加入媒体白名单。
3. “发刚才回执”→“文件直接发我”→“没收到重发”：靠可信服务端 pending receipt operation (sender/bot/bindingId/version/ERP actor/receiptId/TTL) 接续，禁止导向 `erp_excel_template` 或创建采购单；未指定单号且多候选时给业务单号选择而不是猜。
4. 优先把 deterministic `sop/receipt-send.mjs` 与业务消息 `renderers/wecom-business.mjs` 抽出；`AGENTS.md` 只保留何时调用和安全边界，并补 `skills/erp-receipt/SKILL.md`，不要让 LLM 顺序拼 PDF/附件操作。
5. 验收 `发 GW-PURCHASE-119 回执` → 文件 PDF 附件真实显示可下载打开；再 `文件直接发我` → 同一份 PDF 而非 Excel。中文消息使用标题、粗体金额/数量、成功状态，平台支持则用限量颜色；不输出 `MEDIA`、Windows 路径、JSON、6 位小数。测试 015B 原始确认钩子、017A Excel 模板、017B1 草稿、仓库撤权、换绑场景，且**库存不变**。
6. Push `REVIEW_FIX_PUSHED` 与新 HEAD 和脱敏真实消息/附件证据，Cursor 不自行 Merge；F: 备份并统一集成，不重装。

## 第二棒（并行可做 docs，CODE 不争抢 F:）

`AIERP-020A` 已发布，文档 `docs/poc/queue/AIERP-020A.md`，`docs/poc/AGENT_SOP_EXECUTION.md`，`docs/poc/WE_COM_BUSINESS_MESSAGE_STYLE.md`。SOP 触发器+脚本+真实渠道渲染逐步覆盖查库存、采购 Excel、单张确认、回执；别整合未实现的 MIX/SERVICE 过账。可以独立从最新 master 做 docs/代码 PR，**但共享 F: 只能由 015C 收口后集成版本部署**。

禁止优先开 019B 动态网关、017B/017C 多单铺开来分散主线。先把 PDF 回执客户体验做到可验收。
