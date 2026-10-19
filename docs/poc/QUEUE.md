# AI-ERP POC · Delivery Queue

> **唯一工作域：** `youxihe/ai-erp`。它与任何 HR / HCM / ZTO 项目完全隔离：不得读取/修改其他仓库、配置、服务、密钥、数据库或部署管线。

**项目阶段：** POC → 本机真实 ERP 可运行 → Excel 双向交互 → AI Agent → 企微。  
**当前唯一允许自动认领的任务：** `AIERP-001`。  
**队列约束：** 单 Cursor Agent，单一实现 PR（WIP 1）；最多再开一个仅文档 PR。不能因等待人工提供资源而占用所有能力——可做好文档、校验脚本和本地可运行的部分后暂停。

| ID | 优先级 | 状态 | 依赖 | 任务路径 |
|---|---|---|---|---|
| AIERP-001 | P0 | **READY_FOR_REVIEW** | 无 | [本地基线部署](queue/AIERP-001.md) |
| AIERP-002 | P0 | BLOCKED | AIERP-001 | [Excel 生成与导入确认](queue/AIERP-002.md) |
| AIERP-003 | P0 | BLOCKED | AIERP-001 | [真实 ERP 业务 API](queue/AIERP-003.md) |
| AIERP-004 | P1 | BLOCKED | AIERP-002/003 | [Agent 工具与对话](queue/AIERP-004.md) |
| AIERP-005 | P1 | BLOCKED | AIERP-002/003 | [PC / H5 工作台](queue/AIERP-005.md) |
| AIERP-006 | P2 | BACKLOG | AIERP-004/005 | [企业微信接入](queue/AIERP-006.md) |
| AIERP-007 | P2 | BACKLOG | AIERP-004 | [OpenClaw 可插拔评估](queue/AIERP-007.md) |

## 工作流（不依赖 GitHub Issues）

由于本仓库当前 GitHub Issues 功能关闭，**Git 中的 Markdown 任务单 + PR** 是任务控制面。

1. 每次自动巡检先 `git fetch origin`，检查 `origin/master` 中本文件状态、已有 OPEN PR 和任务目录；
2. 只认领 `RELEASED`、依赖已完成、没有正在实现 PR 的任务；在 `docs/poc/queue/AIERP-NNN.md` 对应任务写入 CLAIMED 与本地分支，然后开发；
3. 分支：`feat/aierp-001-local-bootstrap` 等；PR 标题带 `[AIERP-001]`，base `master`；
4. 开发完成本地测试、记录命令和输出，在 PR 中汇报 `READY_FOR_REVIEW`，通知用户/ChatGPT；
5. **Cursor 不自行 Merge，也不擅自把下一个 BLOCKED 改成 RELEASED；** ChatGPT Review、验证合格再合并，并在下次控制面 PR 释放后继；
6. 任何环境资源缺失只记录 `BLOCKED_EXTERNAL_RESOURCE` 及明确的请求清单，不代填 HRM/其他项目配置。

不新建 10 分钟定时任务，除非用户明确要求；若启用，单实例定时检查，仅监控本仓库/本队列。所有自建文件、日志、临时数据必须限制在 `ai-erp` 路径内。

## 验收底线

- 必须区分 **模拟数据、真实 LLM 意图、真实 ERP 过账**；不能混淆。
- 未经人工确认，不提交任何影响库存的单据；涉及仓库权限、租户及重试幂等的边界必须有验证。
- 优先复用 jshERP 原生单据和权限模型；不直接 UPDATE 库存表、不重新造ERP。
- 无需先上线企微或 OpenClaw，先让 PC Demo + 真实 jshERP + Excel 路径稳定。
- 用户要求的 MySQL/Redis 凭据由用户提供，不能从其他项目仓库抄配置；不要在公开 Git 仓库保存真实密钥。

最后一次控制面调整：2026-10-19。