# AIERP-021B READY_FOR_REVIEW / REVIEW_FIX

## HEAD

Branch tip on `feat/aierp-021b-material-masterdata-sop` (use `git rev-parse HEAD` / GitHub branch tip).

## 行为（Review-Fix）

1. 服务类：`MaterialMasterDataService`（镜像 #44 `PartnerMasterDataService`；**禁止**共享旧 `AierpWecomMasterDataService` 路径）。
2. HMAC `POST /aierp/v1/wecom/master/material/prepare`：白名单字段；**prepare + commit** 均校验原生 RoleFunctions「商品信息」funId=23；拒绝 stock 字段；只写 `aierp_master_material_request`。
3. 本人可信私聊 `确认建档物料{申请号}` / `确认修改物料{申请号}` → HMAC `.../master/material/commit`；**必须** `eventSource=WECOM_BEFORE_DISPATCH`（null / LLM 自报拒绝）；群聊拒绝；跨绑定拒绝。
4. Commit 事务写入 `jsh_material` + `jsh_material_extend`；`GET_LOCK`+`FOR UPDATE` 防条码并发；**绝不**写库存表 / depotHead；新建库存合计 0；更新不改 bar_code/单位/历史单据。
5. SOP：`material-upsert.mjs` 物料命名空间确认短语；registry 优先于 `purchase_confirm`；**未改**共享 F: `plugin/index.js` 业务逻辑。

## 本地自动化（无过账）

- `node deploy/scripts/aierp-021b-material-phrase-unit.mjs`（offline）
- `node deploy/scripts/aierp-021b-material-master-flow.mjs`
- 含：低权限 prepare 拒绝、null eventSource、跨绑定、裸确认短语、条码竞态、重放幂等。

## 不做

- 不 Merge；不部署共享 F: OpenClaw 插件覆盖；不碰期初库存/盘点。
