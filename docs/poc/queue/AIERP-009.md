# AIERP-009 · PC/H5 Demo 体验收口（仅一轮）

- **状态**：READY_FOR_REVIEW
- **分支**：`feat/aierp-009-demo-polish`
- **优先级**：P1，**PC Demo v1 已可演示，本任务不阻塞其使用**；正式对客户展示手机端前须完成
- **Owner**：Cursor-ERP，单一实现 PR，ChatGPT Review 和 merge。

## 本轮已完成

1. **行级状态**：按 `results[].businessKey` 显示已审核 / 已拒绝 / 失败 / 待确认；入账后隐藏确认按钮，仅保留回执下载与复制单号。
2. **库存卡片**：只展示原料仓×原料、成品仓×成品；去掉无意义的跨仓零值与空成品 SKU。
3. **最近单据**：单据号、中文类型（采购入库 / 药水配制 / 服务耗料）、格式化时间分行展示，可复制单号。
4. **H5**：进入工作台时收起侧栏/遮罩，隐藏设置抽屉手柄；390×844 / 375×812 可点下载与上传区，无横向溢出。
5. **脚本**：`demo-e2e.mjs` / `excel-flow.mjs` 改为项目相对路径加载 exceljs；轻量回归 `deploy/scripts/demo-ui-smoke.mjs`（不过账）。

## 证据

- 截图：`docs/poc/screenshots/009/`
- 冒烟：`docs/poc/evidence/demo-ui-20261020035627.json`
- 未重新跑会新增单据的 `demo-e2e.mjs`

## 明确禁止（仍遵守）

- 不修改原生 jshERP 库存表、`AierpGatewayService`、Excel 批量确认事务、租户权限、业务金额计算。
- 不新增 LLM、企业微信、OpenClaw，不做大范围 UI 全站换肤。
