# AI-ERP Cursor Agent · 2026-10-21 Next tasks

仓库严格限定 `youxihe/ai-erp`。正式 OpenClaw 是 Windows native `F:\aierp-openclaw`，不重新安装、不升级、不修改其它项目。企微 + DeepSeek + 绑定 ERP 真库存已可用。

## #1：AIERP-013 PR #21 必须先修复的 P0

阅读 https://github.com/youxihe/ai-erp/pull/21 最新 ChatGPT Review 评论。当前 `feat/aierp-013-business-query-tools` 的跨仓混合单据存在 **只要有一条有权明细即可拿到整张单据 `total_price` 与供应商/客户表头信息** 的漏洞。

在原分支最小修复：只允许查询**所有有效明细仓库均授权**的整张单据（列表与详情），新增跨仓双权限用户/合成 fixture 隔离用例；同租户之外完全不能读取。其它混合单位统计和“出库/其它”严格服务口径是 P1，先记技术债别拖延。

重新跑无过账脚本，Push `REVIEW_FIX_PUSHED`，反馈 HEAD/证据；不自行 Merge。

## #2：AIERP-015A（正式 RELEASED，可接力开始）

待 #21 修复分支 Push 后，从当时最新 `origin/master` 建新的 `feat/aierp-015a-purchase-dialog-draft`；可以先做隔离的产品对话和服务端草稿，**不要从未合并的 013 分支派生**，也不要复制 013 未 Review 的功能代码。优先等 013 merge 后再进行完整查询工具联调。

阅读 `docs/poc/queue/AIERP-015A.md`、`docs/poc/adr/AIERP-014D-conversational-confirmation.md` 和 `docs/poc/14d-api-contract.md`。

交付：企微对话提取采购物料/数量/单位/仓库/供应商 → 真实 ERP 匹配与追问 → 经可信绑定 ERP 用户**生成未审核、库存不变的真实 DRAFT** → 返回中文摘要、草稿号、修改/取消/过期提示。严格禁止虚构 HTTP session、ThreadLocal/RequestContextHolder 或共享管理员 Token；如果原生 createDraft 无法安全委托，先完成对话编排并报告受控身份缺口，不得标真实 DRAFT PASS。

**不开发**模型可调用的确认工具、不调用 `draft.confirm`、不新增原生过账，等待 015B Review/Release。短期可以展示本机已登录 ERP 页面作为未来确认路径，但不可宣称企微已入库。

提交真实证据、无过账测试与 `READY_FOR_REVIEW`，Cursor 仍不自行 Merge。

## 安全/运维
不将 HMAC 密钥、企微确认挑战码、聊天记录、ERP 账号密码放到 Git；更新 F: 真实配置前备份并提供脱敏差异。双真实企微身份/低权限 ERP UAT 仍 `NOT_VERIFIED`，在多用户正式试用前必须完成。
