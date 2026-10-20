# AI-ERP POC · Demo-first Delivery Queue

> **唯一工作域**：`youxihe/ai-erp`，与所有 HR/HCM 及其它项目完全隔离。

## 2026-10-20 交付状态

| ID | 状态 | 说明 |
|---|---|---|
| AIERP-001 | **DONE / PR #3** | 独立本地 jshERP 基础环境 |
| AIERP-003 | **DONE / PR #5** | 真实原生采购、组装、服务耗料网关及权限幂等 |
| AIERP-002 | **DONE / PR #7** | XLSX 下载、解析、预览、人工确认、回执 |
| AIERP-005 | **DONE / PR #8** | PC/H5 演示工作台基础入口 |
| AIERP-004 | **DONE / PR #10** | 规则型助手与 ERP 实时库存查询 |
| AIERP-008 | **DONE / PR #12** | PC Demo 集成；17/17 脚本验收、本机浏览器三链路操作；**H5 尚未验收通过** |
| AIERP-009 | **DONE / PR #14** | PC 确认状态、库存与单据排版收口；H5 遮罩已改善，最终补丁的手机点击回归待确认 |
| AIERP-010 | PLANNED | 首页库存按仓库分组、名称与编码并显；非阻断小任务 |
| AIERP-011 | **DONE / PR #17** | Windows native（F:）、DeepSeek 真实回复、企微 WS；启动/运维 Review Fix 已通过 |
| **AIERP-012A** | **RELEASED / next_order #1** | **企微用户绑定 ERP 已登录账号、按账号权限只读查询真实库存** |
| AIERP-012B | PLANNED / after 012A | 采购草稿/复杂报表/确认事件；先验证 012A 的身份审计
| AIERP-006 | BACKLOG | 企微 H5/报表消息增强，等 011/012 基线通过 |
| AIERP-007 | SUPERSEDED by 011 | OpenClaw 安装与企微基础接入由 AIERP-011 承接 |

## Demo-first 里程碑完成；现在启动 Agent 接入阶段

**当前唯一 RELEASED 任务：AIERP-012A。** 按 `docs/poc/queue/AIERP-012.md` 执行**只读**闭环；AIERP-011 PR #17 已 Review + MERGE，当前真实运行时是 `F:\aierp-openclaw` Windows native，不能因为 WSL/Docker 初始规格重复安装。 PC Demo v1 已在本地走通真实 jshERP 的采购 → 药水配制 → 服务耗料链路，支持 XLSX 解析预览、用户确认、真实库存变化、单据号与回执。规则型助手当前标明 `RULE_DEMO`，不是接入大模型的 Agent。

AIERP-009 PR #14 已将 PC 行级状态、近期单据可读性、零库存卡片精简、手机端布局和测试脚本路径收口；ChatGPT Review 附加修复了隐藏全局抽屉的跨页面副作用。原 `009` 手机截图拍于最后一次安全补丁之前，**正式给客户手机展示前，需在最新 master 上快速复核 H5 打开菜单/回到其他 ERP 页面和下载上传控件的实际可操作性**。无需重复执行会新增真实单据的 E2E。

企微 WebSocket + DeepSeek 聊天已实测成功。现在以企微私聊身份发起 ERP 账号绑定，用户在**已经登录的 ERP PC 页面**核验绑定短码，再用专用只读工具查询库存。若无法从官方 Channel 工具上下文取得可信的企微发送者身份，**不得采用 LLM 参数里的 userId 冒充身份**；本轮如实报 BLOCKED_IDENTITY_CONTEXT。

**使用限制**：目前是本机 POC，不是生产上线；演示数据为虚构软件测试配比；原生 jshERP 其他写入口尚不共用 AI 网关库存行锁。所有 ERP 项目与 HR/HCM 资源隔离。Cursor 不自行 Merge，不新增未释放任务。AIERP-012A 禁止采购过账和管理员共享 Token。
