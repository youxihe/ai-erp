# AI-ERP Cursor · 当前客户 Demo 两棒接力（2026-10-21 20:48）

**master 已合并**：AIERP-015B PR #27（单张采购可信原文入库）、019A PR #31（ERP 能力目录/SOP）。**目前 PR #30 Excel 预览修复未合并**。

### 第一棒：原 PR #30 · 少量 P0 与模板/文案收口

用户在企微发送 Excel 后，后台已实际返回 PREVIEWED：`T-20261021`，1 张采购单，100 L RM-A001，华东化工，原料仓，20 元/L，错误 0。**无需继续重复诊断已成功的文件字节收发**。

立即按 PR #30 ChatGPT Round 4 评论修复：
1. 删除服务端 `purchasePrepare` 接受模型参数 `excelWorkflowCancel:true` 的绕过；Redis 文件工作流只允许本人调用独立可信 `取消文件` 关闭。补恶意绕过负例。
2. 完善真实 XLSX 模板设计：优先看 jshERP 原生模板是否可复用；现有模板表头/数据裸文本、没有必填/选填；采购单号首次被漏填。清晰、好看的企业模板：必填 *、选填提示、字段填写说明/例子、分组与标题、冻结表头、筛选、列宽/打印、错误回传友好；预填必须自动带唯一业务单号和日期，不能编造供应商/价格。保留模板解析兼容。
3. 面向用户只输出“文件已核对：1张采购单，100L×20=2000元，华东化工、原料仓，数据无误，**尚未入库**”，不展示 `status=PREVIEWED`、`previewId`、`scene`、`canConfirm` 或 “行null”。修正行号从 sourceRows 获取。
4. 上传成功以后服务端能用可信 WeCom sender/bot/binding generation 找到最新有效 preview；即使模型/会话重启也不能回复“未收到文件”。017A 只预览，明确下一步，不要自行入库/新建猜测草稿。
5. 原分支 `feat/aierp-017a-wecom-xlsx-inbound-preview` 同步最新 master，保留单张采购的 trusted before_dispatch 确认和 13 工具；提交非过账测试、真实企微简洁回复证据，Push `REVIEW_FIX_PUSHED`，等 ChatGPT 合并。Cursor 不自行 Merge。

### 第二棒：AIERP-017B1 · 一张采购单 Excel 的最快正式闭环

**任务卡已释放但有合并门槛**：`docs/poc/queue/AIERP-017B1.md`，只有 #30 最终 Review/Merge 后才部署。可在 #30 Push Fix 后先读任务卡/准备隔离实现分支，不能动 F: 共享运行环境。

目标：已经正确解析且单一有效采购业务单的 Excel → 服务端从 previewId 的存档 normalized lines 创建**真正未审核 DRAFT**（不是由 Agent 猜数量）→ 企微返回真实草稿摘要及 `确认采购{id}` → 用户本人仅确认一次 → 复用 015B 原生事务入库、返回真实单据与库存变化。下一句“入库吧”不能丢失 preview；最多提示一次明确确认短语，不要求用户重新传文件。**严禁模型调用 excel.confirm**。

数据来源绑定用户+bot+ERP 租户+bindingVersion+fileSha256+previewVersion，同一 Excel/业务号幂等；文件编辑重传使旧确认失效；不自动确认 #113 和 #111。多张单、配制生产、服务耗料扩展留 017B/017C。

本轮不要启动 019B 通用动态工具框架；客户 Demo 交付速度优先。。
