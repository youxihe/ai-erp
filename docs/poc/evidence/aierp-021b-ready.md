# AIERP-021B READY_FOR_REVIEW

## HEAD

`89e1c87a8f924e377160ff4e882f0dcb110454ab` on `feat/aierp-021b-material-masterdata-sop`。

## 行为

1. HMAC `POST /aierp/v1/wecom/master/material/prepare`：白名单字段校验（name/barCode/unit 必填；类别/规格/品牌/备注可选），仅引用租户已有分类与单位；**拒绝 stock/initStock 等库存字段**；只写 `aierp_master_material_request`，不写 `jsh_material`。
2. 本人可信私聊回复 `确认建档{申请号}` / `确认修改{申请号}` → HMAC `.../master/material/commit`（`WECOM_BEFORE_DISPATCH`）；群聊与 LLM 自报 `eventSource` 拒绝。
3. Commit 事务写入 `jsh_material` + `jsh_material_extend`（条码/SKU/单位）；**绝不**写 `jsh_material_current_stock` / `jsh_material_initial_stock` / depotHead；新建库存合计 0。
4. 本棒禁止改 bar_code / 基础单位；更新仅 name/standard/brand/remark；同申请重放幂等。
5. SOP：`deploy/openclaw/sop/material-upsert.mjs` + registry 优先于 `purchase_confirm`；**未改** `plugin/index.js`，无 F: 覆盖。

## 本地自动化（无过账）

- `node deploy/scripts/aierp-021b-material-master-flow.mjs`：**ALL PASS**
- 证据：`docs/poc/evidence/aierp-021b-material-master-*.json`
- 样例：`RM-TEST-*` → Material+Extend 落库；current/initial stock 行数 0；改备注成功；重复条码 409；stock 字段 400。

## 真人企微 UAT

- 脚本覆盖 prepare/commit/HMAC/绑定链路；真人私聊确认可按 DEMO_UAT §4–5 补做。
- `LIVE_WECOM_CONFIRM=PENDING_USER`（可选）。

## 不做

- 不 Merge；不部署共享 F: OpenClaw 插件；不碰期初库存/盘点。
