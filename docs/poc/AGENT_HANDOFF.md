# AI-ERP Agent · 当前唯一关键任务：017A 真实文件预览失败修复

**Repo** `youxihe/ai-erp`。当前 master：
- PR #27 AIERP-015B **已合并**（`c94e192c`）：真人企微采购 #111 原生成功入库，18/18 修复安全测试。
- PR #31 AIERP-019A **已合并**（`6a447f13`）：operationId 目录、采购/库存/生产/耗料/分析/Excel SOP；运行时动态网关 019B 未释放。
- **PR #30 AIERP-017A REVIEW_FIX_REQUIRED**：Java Excel 预览 14/14 PASS，但企微真实文件上报未生成 previewId。Agent 把 `采购入库模板---100L---.xlsx` 的文件名内容当做数量创建未审核采购草稿 #113。**不得确认或自动处理 #113**。

## P0 收口步骤（执行，无需再等待用户下指令）

1. 阅读 GitHub PR #30 最新 ChatGPT Round 3 评论（`docs/poc/QUEUE.md` 也已写明）；在原分支从最新 `origin/master` rebase/merge，保留 015B `before_dispatch` 原文确认钩子，13 个模型工具和 017A Excel 处理；不覆盖已合并的目录/SOP。
2. 在 F:\aierp-openclaw 真正生效的官方企业微信 SDK 和 OpenClaw 插件源码中查入站原始文件 → 媒资下载 → 临时落盘 → 插件消息钩子；只记录脱敏文件后缀/SHA/消息 ID/发送者掩码、hook 到达/staged 状态/异常，不能上传客户真实文件到 Git。官方 `message_received` 为 OBSERVE；`inbound_claim` 仅在 owner plugin 已绑定路由时触发，不能靠修改这两个 hook event 字段完成可靠预览。
3. 用已认证的企微私聊身份和真实 staged XLSX **bytes** 调 Java `previewAs`，服务端严格校验文件 hash 与绑定 ERP actor/tenant/warehouse；生成 `previewId` 才允许回复“已解析”。失败明确回复 `FILE_PARSE_FAILED`，不让 DeepSeek 凭文件名/历史猜行数、数量、供应商/价格。
4. **服务端 file workflow 状态阻断**：本阶段用户上传 XLSX/要求按文件内容创建草稿时，如果没有 verified `PREVIEWED`，不得借原单张 `erp_purchase_prepare` 建一个假定文件来源的草稿。只能在用户明确取消文件流程并重新开始独立口头采购后走普通草稿。
5. 回归：真实修改 .xlsx，文件名 `采购入库模板---100L---.xlsx` 但单元格保留 20L 时，真实 preview 返回 20L，并展示预览 ID/行/单据/错误；原生库存和已审核单据不变，期间新草稿数为 0。验证模型无权触发 excel.confirm、单张真实确认钩子没有被改没。日志查清 FILE_SENT 与 PREVIEWED 的独立状态。
6. 非过账本地脚本 + 可信企微真人附件收发预览证据，Push `REVIEW_FIX_PUSHED` 新 HEAD，ChatGPT 审阅再 Merge；不自行 Merge，暂不释放 017B/C。

运行实例只有一个 F:，不能任由不同 PR 覆盖安装；部署前备份现有插件、MD、配置和版本，不重新安装。
