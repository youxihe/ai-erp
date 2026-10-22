# AIERP-016M READY_FOR_REVIEW

- **Branch**: `feat/aierp-016m-mix-sop`
- **HEAD**: `58c80d42`
- **Base**: `origin/master` `74b32fe8`
- **Status**: READY_FOR_REVIEW (no merge; no F: deploy)
- **Evidence**:
  - `docs/poc/evidence/aierp-016m-mix-prepare.json`
  - `docs/poc/evidence/aierp-016m-mix-prepare-flow.json`
- **Non-post tests**: ALL PASS (Excel 1 MIX×3 raw → 1 DRAFT, stock unchanged; HMAC reject `确认采购` on MIX; bare「确认」rejected for MIX; unconfirmed recipe refused; insufficient stock rejected)
- **Boot**: rebuilt locally via `deploy/docker-compose` (not F: OpenClaw plugin deploy)

## UAT（Demo B）

1. 企微私聊「配制模板」→ 同配制单号填 3 行原料（用户测试配比）+ FG-101 产出到成品仓。
2. 回传 Excel → 待确认数字草稿；原料仓/成品仓库存**不变**。
3. 本人回复 `确认配制{draftId}` → 原生 `GW-MIX-{id}` 已审核；FG↑、各原料↓；文字回执含成品+原料双向；**无采购 PDF**。
4. 负例：原料不足 / 误用 `确认采购{n}` / 单独「确认」/ 重放确认。

## Gaps

- 非完整 MES/BOM/多工序（票内边界）。
- MIX 专用 PDF 未做（明确不冒充采购回执）。
- 默认原料仓→成品仓；多仓/版本后续。
- 真企微端到端需部署 OpenClaw 插件后人工验（本 PR 不覆盖 F:）。
- 确认过账路径以 HMAC 负例 + 代码路径覆盖；正例过账留给 UAT（避免共享库存扰动）。
