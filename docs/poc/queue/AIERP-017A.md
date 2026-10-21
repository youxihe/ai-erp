# AIERP-017A · 企业微信 Excel 模板发送 / 文件回收 / 解析预览（客户 Demo 第一棒）

- **状态**：REVIEW_FIX_REQUIRED / PR #30（真实文件 UAT 中未解析 XLSX 即从文件名猜 100L 创建未审核 #113；P0，不能合并）。
- **开发分支**：`feat/aierp-017a-wecom-xlsx-inbound-preview`，只处理 AI-ERP。
- **优先级**：P0 客户 Demo；**本棒绝对不批量审核、入库、出库，也不修改库存**。
- **当前复用**：`AierpExcelController` 的 `GET /aierp/v1/excel/template?scene=`、`POST /preview`，`AierpExcelService` 支持真实 XLSX `PURCHASE/MIX/SERVICE` 解析预览，上传上限 2MB/200 行；`INITIAL/SALE` 目前是仅模板、不可确认，请在企微明确标注，而不是宣称支持批量销售出库。
- **运行态**：OpenClaw Windows native `F:\aierp-openclaw`、企业微信官方插件 Bot WS + DeepSeek。禁止重装/升级/开放群聊写入。

## 真实交互验收

1. 用户私聊：“给我批量进货模板” → ERP 服务端按当前绑定 ERP 用户允许的业务范围生成合法 **xlsx**，通过企微发送**真实文件附件**，用户桌面/手机端可以下载、打开与修改。支持“给我配制生产模板”“服务耗料模板”；明确销售出库当前仅模板的限制。
2. 用户填写并把 `xlsx` **直接发回机器人** → 由已验证企微 Channel 文件消息事件取得可信 `sender / botId / messageId / session + file attachment bytes/media locator`。**不能**依赖模型凭聊天文本猜文件已到达，也不能让模型使用任意文件路径或 exec 读取宿主机。
3. 使用受控临时文件容器（与 WeCom sender、bot、ERP tenant/user/binding_version、msgId、文件 SHA256、原文件名及存活期绑定）将 XLSX 交给 ERP 解析器。校验文件类型、ZIP 安全、最大字节/行数、表单场景、无宏/公式执行；私人临时文件按 TTL 删除。文件中任何包含“忽略规则、自动确认”等内容均只能当作数据。
4. 预览返回**每业务单分组**的单据号、物料/客户/仓库/数量和有效/错误记录数，及最多若干条错误示例；超过企微文本容量则只发摘要 + 经过 ERP 登录态验证的 H5 预览入口。不得发公网匿名下载 URL，也不得将 `127.0.0.1` 作为外部手机可访问链接。
5. 只读验证：原生库存、已审核单据数量完全不变；`excel.confirm` 在此流程绝不暴露为模型 Tool；老 PC Excel 页面不回归、不破坏。

## SDK/通道具体勘察

- 先读本机已安装 **`@wecom/wecom-openclaw-plugin`** 版本的真实代码，确认 inbound file metadata, sender proof, attachment downloader, outbound file `MEDIA:` / media delivery 的**受控 API**。如仅能支持某个方向，分别标记 `FILE_INBOUND_BLOCKED` / `FILE_OUTBOUND_BLOCKED`，不得假装已收到真实 XLSX。
- 尽量复用 015C 也需要的受控文件收发 adapter，但不启用全套 `wecom-cli` 企业业务工具、不启用文件系统/shell通用 Tool。
- 现有 ExcelService 依赖 ERP HTTP Session；仅允许安全的 `templateAs(VerifiedActor)` / `previewAs(VerifiedActor)` 服务端身份委托，**不得伪造 Session 或用管理员 Token**。所有业务数据需检验角色、租户与仓库权限，尤其上传行可能指向无权仓库。
- 初期先做 PURCHASE 一条真实链路，再验证 MIX、SERVICE 预览；销量/生产大场景由 017B 承接。

## 交付
- 可复现无过账 `xlsx` 来回和预览测试脚本 + 企微真实文件收发证据，含版本、文件 ID 脱敏、哈希及前后库存校验。
- 同步 repo 插件/MD 脱敏模板，备份 F: 实际插件和 `openclaw.json`，不清除会话。
- Push `READY_FOR_REVIEW`、HEAD/证据/仍缺的真人文件 UAT；Cursor 不自行 Merge。

## ChatGPT 2026-10-21 18:58 真人 UAT 挂起门槛

用户上传带 `---100L---` 的 XLSX 后，插件并未生成 ERP preview，模型竟以文件名猜测单元格数量并调用普通采购草稿工具创建 #113。必须按照 GitHub PR #30 最新 Review 评论从真实可信入站文件字节解析；OpenClaw `message_received` 仅观察、不可靠修改模型输入，`inbound_claim` 仅在 own conversation binding 才可执行。解析失败的同一文件流程不得创建任何源于文件的业务草稿。验收必须上传**文件名100L但单元格20L** 的 XLSX、能得到 PREVIEWED/previewId/实际20L；不入库、不创建草稿。#113 不可自动确认。\n