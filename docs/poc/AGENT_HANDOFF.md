# AI-ERP Cursor Agent · 下一阶段：对话式业务查询与业务办理设计

**仓库唯一**：`youxihe/ai-erp`；与 HR/HCM/其他项目资源完全隔离。

## 已完成

- AIERP-001/002/003/004/005/008/009：本机 PC Demo 的三条真实采购、配制、服务耗料过账链路、Excel 模板/预览/确认、真实库存。
- AIERP-011 PR #17：Windows native OpenClaw `F:\aierp-openclaw` + DeepSeek + WeCom WS。
- AIERP-012A PR #19：可信企微身份、ERP 已登录用户绑定、HMAC + nonce、实时库存与用户/租户权限重查。用户已在企微截图实测单账号真实库存；17/17 自动化 PASS，双真实企微/ERP 不同权限的 UAT 仍 `NOT_VERIFIED`。

## 接力任务

1. **AIERP-013**：分支 `feat/aierp-013-business-query-tools` 已实现只读物料/往来/单据/报表查询，自动化无过账测试 + 证据见 `docs/poc/evidence/aierp-013-*`，状态 **READY_FOR_REVIEW**（Cursor 不自行 Merge）。
2. **AIERP-014D docs-only**：从最新 `origin/master` 独立分支 `product/aierp-014d-conversational-transaction-design`；交付确认协议 ADR、中文对话样例、API 合同。**不编码采购确认/写单据功能**。
3. 015/016/017 未 RELEASED，禁止提前写工具或自行 Merge。

## 不变的边界

- F: 真实 OpenClaw 安装、插件/会话均保留，修改 `openclaw.json`、`AGENTS.md` / `SOUL.md` 等前必须本机备份，更新 repo 脱敏模板并检查实际安装环境。无需重新安装、升级或迁回 Docker/WSL。
- OpenClaw 只提供语义理解、对话、工具选择；Java ERP adapter 决定可信身份、权限、参数白名单、查数/修改与过账。
- 不向 Git 提交 Secret、绑定码、原始聊天、ERP 用户密码；不借用其他项目凭据；不让 DeepSeek 使用 Shell、任意 HTTP、SQL。
- 不用共享 ERP 管理员 Token 代表企微普通用户；双用户权限 UAT 仍是下阶段上线门槛。
- 不要反复运行会真正改变库存的 `demo-e2e`；只读测试与后台真实记录交叉核对。

Cursor Push 任务 HEAD / 测试 / 脱敏证据及 `READY_FOR_REVIEW`，GitHub PR 可由 ChatGPT 创建、Review、合并。**Cursor 不自行 Merge**。
