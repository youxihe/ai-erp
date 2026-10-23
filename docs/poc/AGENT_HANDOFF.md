# AI-ERP Cursor · 2026-10-23 本地 Demo 并行快线（本段优先于旧 handoff）

用户明确同意：**持续开发 → 本地自动化 → 提前 Demo 部署 ↔ 用户实时企微验收 ↔ ChatGPT 并行 Review/Merge**。完整安全/部署/验收约束见 `docs/poc/FAST_DEMO_DELIVERY.md`。不再等所有功能审完再让用户看页面/发送 Excel。

## GitHub 当前
- 017B2 #41 **DONE** `db13699f`；016M #42 **DONE** `bccd9f52`；016S #43 **DONE** `baefd2a4`；Ops #47 **DONE** `0c841fbd`。
- #44 (Partner) / #45 (Material) **INTEGRATION**：先同步最新 master，修角色、并发唯一性、可信消息隔离，运行真实 DB 回归；允许在未完整 Review 时提前部署业务**字段预览/申请准备**，写入确认入口待最小安全负例通过。
- **017C1 RELEASED NOW**：从最新 master 并行开 `feat/aierp-017c1-purchase-batch-confirm`。批次 manifestHash + revision、本人真实企微 `确认批次{batchId}`、逐单原生幂等审核、PARTIAL_SUCCESS 与 XLSX 回执。可以提前部署**批次清单/草稿展示**，可信批次提交未经过角色/绑定/幂等测试前必须禁用。不要模型直接调用旧 excel.confirm。
- 020A WeCom/Feishu 各自消息渲染及 SOP script 可并行，不因字体/卡片阻塞业务演示。

## 立刻执行两条流水线
**Deploy Owner（单 Agent、单运行态）**：从当前最新 `origin/master` clean-build / hot-reload（#47），备份并同步 F: OpenClaw 插件；核对 jar host=container SHA、Boot/Gateway health、当前渠道工具/SOP；先跑 017B2 18/18、MIX 22/22+28/28、SERVICE 不入账回归。报告用户可立即测试的**自然语言**和 3 场景，**不强迫用户等 #44/#45**。记录原料/成品当前库存，不复用昨天值。部署动作只有唯一负责人，别让 5 条分支同时写 `deploy/runtime/app.jar` 或 F:。
**Dev Agents（并行）**：#44/#45 从自己的 worktree 合并最新 master 并尽快 Push 新 HEAD + 实际 DB 回归；017C1 独立开工 Push 早期可运行子 PR；在已部署安全版本上处理用户当场反馈，修完即可重新部署预览，不要求 ChatGPT 在每一轮先 Review。
**ChatGPT（本对话）**：同时审实质差异，快速合并低风险/安全闸门通过的功能；若发现跨租户/代际权限或重复过账风险，暂停**对应写入口**但不阻塞其它场景的预览、SOP 研发或本地用户体验测试。

## 进度交接固定格式
`PR/HEAD, Java BUILD, non-post regressions, live UAT, deployed Boot JAR SHA, F-plugin SHA, enabled business routes, gated write capabilities, rollback artifact`。区分 GitHub MERGED、LOCAL_DEPLOYED、LIVE_UAT_PASS；不得混同。

**请立即认领工作，不需等我下一次“继续”才开工。** 对 #44/#45 与 017C1 可并行 Push，但不自行对用户真实历史单据确认或重复入库。人可以明确批准新的测试草稿和本人确认。
