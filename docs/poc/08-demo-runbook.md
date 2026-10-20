# AIERP-008 · 客户演示操作说明（本机）

## 1. 启动

独立 AI-ERP 栈（不要用 HR 的 Redis/数据库）：

```powershell
cd D:\ERP\ai-erp
# Docker：aierp-mysql :13306 / aierp-redis :16379 / aierp-boot :9999
deploy\scripts\start-all.ps1   # 若容器已在跑可跳过
```

前端（本机实测端口）：

```powershell
cd D:\ERP\ai-erp\jshERP-web
npx vue-cli-service serve --port 3002
```

打开：`http://localhost:3002/dashboard/aierp`  
上游默认账号（仅 loopback）：`jsh` / `123456`

验证码：日常保持开启。自动化脚本会临时关闭并恢复。

## 2. 客户讲解脚本（约 5 分钟）

1. **首屏**：展示原料仓 / 成品仓真实库存卡片和最近网关单据。说明不是 localStorage 模拟。
2. **助手**：输入“查表面活性剂库存”。页面标注 **本地规则演示（RULE_DEMO）**，回答数字来自当前登录 ERP 会话。说明不会代替确认过账。
3. **采购**：下载采购 Excel → 填写（样例 `docs/poc/samples/purchase-demo.xlsx`）→ 上传 → 预览显示“库存尚未变化”→ 点击确认 → 出现原生单号 `GW-PURCHASE-*`，原料仓 `RM-A001` +2 L → 下载回执。
4. **配制**：切换“药水配制”，上传 `mix-demo.xlsx`。虚构配比 A0.6/B0.1/C0.3 → FG-101 +1 L。强调不是化学工艺。
5. **服务耗料**：上传 `service-demo.xlsx`，客户“苏州精密电子”，成品仓 FG-101 −1 L，单据类型是出库/其它，不是销售。
6. **护栏**：故意带错单位的行只会 REJECTED；同一批次再点确认不会再次扣库存。

## 3. 本轮真实证据（2026-10-20）

### API 联调（合并后的 master JAR）

证据：`docs/poc/evidence/demo-e2e-20261020014600.json`

| 链 | 业务单号 | 原生单据 | 库存变化 |
|---|---|---|---|
| 采购 | POC-PI-008-20261020014600 | GW-PURCHASE-91 | RM-A001 135.9 → 137.9（错单位行 REJECTED） |
| 配制 | POC-MIX-008-20261020014600 | GW-MIX-92 | FG-101 152 → 153；RM-B002 5 → 4.9 |
| 服务 | POC-SV-008-20261020014600 | GW-SERVICE-93 | FG-101 153 → 152 |

助手：`mode=RULE_DEMO`，库存查询走网关；“给我采购表”返回模板 Action，文案不再含“待接入”。

### 浏览器联调（`http://localhost:3002/dashboard/aierp`）

截图：`docs/poc/screenshots/`

| 文件 | 内容 |
|---|---|
| 01-pc-home.png | 首屏真实库存 + RULE_DEMO |
| 02-pc-assistant.png | 助手查到原料仓 137.3 L |
| 03-pc-preview.png | 采购上传后预览、库存未变 |
| 04-pc-confirm.png | 确认后 GW-PURCHASE-94，RM-A001 139.3 |
| 05-pc-three-chains.png | 配制/服务后库存（A 138.7 / B 4.8 / FG 152） |
| 06-h5-workbench.png | 390×844，栏位纵向、无横向溢出 |

浏览器追加单据：`GW-PURCHASE-94`、`GW-MIX-95`、`GW-SERVICE-96`。二次确认后库存仍停在确认后余额。

## 4. 自动化命令

```powershell
node deploy/scripts/demo-e2e.mjs
node deploy/scripts/excel-flow.mjs
node deploy/scripts/assistant-flow.mjs
```

## 5. 配置清单

| 项 | 是否需要客户提供 |
|---|---|
| 本机 Docker MySQL/Redis/jshERP | 否，仓库自带 |
| 演示账号 jsh/123456 | 否，上游默认，仅本机 |
| 大模型 API Key | 否；当前 RULE_DEMO |
| 企业微信 / OpenClaw | 否，不在本轮范围 |

## 6. 已知限制

见 `docs/poc/TECH_DEBT.md`。原生 ERP 其他页面不走 AI 网关库存锁；H5 窄屏下上游布局侧栏仍占空间，业务区已纵向堆叠。
