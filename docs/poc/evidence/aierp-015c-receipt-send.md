# AIERP-015C · 真实采购入库回执 PDF 检索与企微发送证据

## 范围

- 分支：`feat/aierp-015c-wecom-real-receipt-pdf`
- 只读：`GW-PURCHASE-119`（已审核），**未**新建采购、**未**确认草稿、**未**改库存
- F: 插件备份：`F:\aierp-openclaw\state\extensions\aierp-erp-tools.bak-015c-*`（未重装 OpenClaw）

## Java / 接口

| 检查 | 结果 |
|---|---|
| `mvn package`（Docker maven + m2 cache） | BUILD SUCCESS |
| HMAC `POST /aierp/v1/wecom/receipt/find`（bill=GW-PURCHASE-119） | PASS |
| HMAC `POST /aierp/v1/wecom/receipt/file` → PDF bytes + sha256 | PASS |
| 缺失单号 / 他企微身份 / 路径注入 | 拒绝 PASS |
| 库存 before/after | 不变 PASS |
| 单据 status | 仍为已审核 `1` |

落盘：`docs/poc/evidence/aierp-015c-receipt-file.json`、`aierp-015c-GW-PURCHASE-119.pdf`

## 意图路由

`deploy/scripts/aierp-015c-intent-unit.mjs`：回执请求命中、模板/确认不命中 → PASS（`aierp-015c-intent-unit.json`）

## #35 安全补丁非过账回归

`deploy/scripts/aierp-017b1-verified-draft.mjs` → **11/11 ALL_PASS**（含 preview hash / prepare-verified 代际 / 改文件取消旧草稿）

## 插件

- `before_dispatch` 优先处理回执意图 → `/receipt/file` → 受控 `MEDIA:` PDF（不走 `erp_excel_template`）
- 模型工具仍为 **13** 个；无 `erp_draft_confirm` / `excel.confirm`

## 企微客户端送达

自动化已验证 adapter 能取出真实 `%PDF` 且 hash 匹配；**`PDF_SENT_VERIFIED` 需用户在企微私聊发送「发 GW-PURCHASE-119 回执」并确认客户端可打开后标记**。发送失败不得改库存、不得称未入库。
